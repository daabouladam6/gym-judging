import fs from "node:fs";
import path from "node:path";

const LOG = path.join(process.cwd(), "debug-5f3141.log");

/** Fly: visible in `fly logs`. Local: NDJSON file + optional Cursor ingest. */
export function dbgBoot(
  location: string,
  message: string,
  data: Record<string, unknown> & { hypothesisId: string },
): void {
  const payload = { sessionId: "5f3141", timestamp: Date.now(), location, message, ...data };
  const line = JSON.stringify(payload) + "\n";
  try {
    fs.appendFileSync(LOG, line);
  } catch {
    /* ignore */
  }
  console.error("[boot-debug]", line.trimEnd());
  // #region agent log
  void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}

dbgBoot("debugBoot.ts", "module evaluated", { hypothesisId: "H1", cwd: process.cwd() });
