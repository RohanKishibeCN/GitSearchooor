import fs from "node:fs";
import path from "node:path";

export function appendDeadletter(filePath: string, payload: object): void {
  const p = path.resolve(filePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, `${JSON.stringify(payload)}\n`, "utf8");
}

