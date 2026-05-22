import { Command } from "commander";
import { loadConfig, loadEnvFile, redactedConfig } from "./config";
import { StateDB } from "./db";
import { GitHubClient } from "./github/client";
import { NotionWriter } from "./notion/writer";
import { runLoop, runOnce } from "./bot";

async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program.name("gitsearchooor");
  program.option("--env-file <path>", "env file path", ".env");

  program
    .command("print-config")
    .description("print final config (tokens redacted)")
    .action(() => {
      const opts = program.opts<{ envFile: string }>();
      loadEnvFile(opts.envFile);
      const cfg = loadConfig();
      process.stdout.write(`${JSON.stringify(redactedConfig(cfg), null, 2)}\n`);
    });

  program
    .command("init-db")
    .option("--db-path <path>", "sqlite db path override", "")
    .description("init sqlite state db")
    .action((cmdOpts: { dbPath?: string }) => {
      const opts = program.opts<{ envFile: string }>();
      loadEnvFile(opts.envFile);
      const cfg = loadConfig();
      const p = cmdOpts.dbPath && cmdOpts.dbPath.trim() ? cmdOpts.dbPath.trim() : cfg.paths.sqliteDbPath;
      const db = new StateDB(p);
      db.init();
      db.close();
      process.stdout.write(`ok: ${p}\n`);
    });

  program
    .command("run")
    .option("--dry-run", "do not write to notion", false)
    .description("run one scan cycle and exit")
    .action(async (cmdOpts: { dryRun?: boolean }) => {
      const opts = program.opts<{ envFile: string }>();
      loadEnvFile(opts.envFile);
      const cfg = loadConfig();

      assertRequired(cfg, { dryRun: Boolean(cmdOpts.dryRun) });

      const db = new StateDB(cfg.paths.sqliteDbPath);
      db.init();

      const gh = new GitHubClient({
        baseUrl: cfg.github.apiBaseUrl,
        token: cfg.github.token,
        userAgent: cfg.github.userAgent,
        timeoutSec: cfg.github.httpTimeoutSec,
        searchMinRemaining: cfg.github.searchMinRemaining,
        coreMinRemaining: cfg.github.coreMinRemaining
      });

      let notion: NotionWriter | undefined;
      if (!cmdOpts.dryRun) {
        notion = new NotionWriter({ token: cfg.notion.token, databaseId: cfg.notion.databaseId, props: cfg.notion.props });
        await notion.validateDatabaseSchema(cfg);
      }

      const stats = await runOnce(cfg, { dryRun: Boolean(cmdOpts.dryRun), db, gh, notion });
      db.close();
      process.stdout.write(`${JSON.stringify(stats)}\n`);
    });

  program
    .command("loop")
    .option("--dry-run", "do not write to notion", false)
    .description("run in a loop with adaptive sleep")
    .action(async (cmdOpts: { dryRun?: boolean }) => {
      const opts = program.opts<{ envFile: string }>();
      loadEnvFile(opts.envFile);
      const cfg = loadConfig();
      assertRequired(cfg, { dryRun: Boolean(cmdOpts.dryRun) });
      await runLoop(cfg, { envFile: opts.envFile, dryRun: Boolean(cmdOpts.dryRun) });
    });

  await program.parseAsync(argv);
  return 0;
}

function assertRequired(cfg: ReturnType<typeof loadConfig>, opts: { dryRun: boolean }): void {
  if (!cfg.github.token) throw new Error("GITHUB_TOKEN is empty");
  if (!opts.dryRun) {
    if (!cfg.notion.token) throw new Error("NOTION_TOKEN is empty");
    if (!cfg.notion.databaseId) throw new Error("NOTION_DATABASE_ID is empty");
  }
}

main(process.argv).catch((e) => {
  process.stderr.write(`${String(e?.message ?? e)}\n`);
  process.exit(1);
});
