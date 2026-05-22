import { Client } from "@notionhq/client";
import type { Config, NotionPropertyKey } from "../config";

type NotionPropertyType =
  | "title"
  | "rich_text"
  | "url"
  | "select"
  | "multi_select"
  | "number"
  | "date";

export class NotionSchemaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class NotionWriter {
  private client: Client;
  private databaseId: string;
  private props: Record<NotionPropertyKey, string>;

  constructor(opts: { token: string; databaseId: string; props: Record<NotionPropertyKey, string> }) {
    this.client = new Client({ auth: opts.token });
    this.databaseId = opts.databaseId;
    this.props = opts.props;
  }

  async validateDatabaseSchema(cfg: Config): Promise<void> {
    if (!cfg.notion.databaseId) throw new NotionSchemaError("NOTION_DATABASE_ID is empty");
    const db = await this.client.databases.retrieve({ database_id: cfg.notion.databaseId });
    const properties = (db as any)?.properties ?? {};

    const expected: Array<[NotionPropertyKey, NotionPropertyType]> = [
      ["title", "title"],
      ["repo_url", "url"],
      ["file_url", "url"],
      ["file_path", "rich_text"],
      ["term", "multi_select"],
      ["ecosystem", "select"],
      ["snippet", "rich_text"],
      ["blob_sha", "rich_text"],
      ["dedup_key", "rich_text"],
      ["first_seen", "date"],
      ["last_seen", "date"],
      ["hit_count", "number"],
      ["status", "select"],
      ["notes", "rich_text"],
      ["tags", "multi_select"]
    ];

    for (const [k, ty] of expected) {
      const name = cfg.notion.props[k];
      const p = properties[name];
      if (!p) throw new NotionSchemaError(`Notion database missing property: ${name}`);
      if (p.type !== ty) throw new NotionSchemaError(`Notion property type mismatch: ${name} expected=${ty} actual=${p.type}`);
    }

    const statusName = cfg.notion.props.status;
    const statusProp = properties[statusName];
    const options: Array<{ name: string }> = statusProp?.select?.options ?? [];
    if (!options.some((o) => o?.name === cfg.notion.defaultStatus)) {
      throw new NotionSchemaError(`Notion select options missing: ${statusName} option=${cfg.notion.defaultStatus}`);
    }
  }

  async createPage(fields: Record<string, any>): Promise<any> {
    return await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: this.toProperties(fields)
    } as any);
  }

  async updatePage(pageId: string, fields: Record<string, any>): Promise<any> {
    return await this.client.pages.update({
      page_id: pageId,
      properties: this.toProperties(fields)
    } as any);
  }

  private toProperties(fields: Record<string, any>): Record<string, any> {
    const props: Record<string, any> = {};

    const rt = (s: string) => ({ rich_text: [{ type: "text", text: { content: s } }] });
    const title = (s: string) => ({ title: [{ type: "text", text: { content: s } }] });
    const ms = (names: string[]) => ({ multi_select: names.filter(Boolean).map((n) => ({ name: n })) });

    for (const [k, v] of Object.entries(fields)) {
      const key = k as NotionPropertyKey;
      const name = this.props[key] ?? k;

      if ((k === "repo_url" || k === "file_url") && typeof v === "string") {
        props[name] = { url: v };
      } else if (k === "title" && typeof v === "string") {
        props[name] = title(v);
      } else if ((k === "first_seen" || k === "last_seen") && typeof v === "string") {
        props[name] = { date: { start: v } };
      } else if (k === "hit_count" && typeof v === "number") {
        props[name] = { number: v };
      } else if (k === "term" || k === "tags") {
        if (typeof v === "string") props[name] = ms([v]);
        else if (Array.isArray(v)) props[name] = ms(v.map(String));
        else props[name] = ms([]);
      } else if ((k === "ecosystem" || k === "status") && typeof v === "string") {
        props[name] = { select: { name: v } };
      } else {
        props[name] = rt(String(v ?? ""));
      }
    }

    return props;
  }
}

