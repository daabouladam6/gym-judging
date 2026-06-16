import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dbgBoot } from "../debugBoot.js";
import * as schema from "./schema.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(dir, "../../data/gym.db");
/** DB loads before server/index.ts body runs — ensure data dir exists first (fresh Docker/Fly). */
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
dbgBoot("db/index.ts", "after mkdirSync", { hypothesisId: "H1", dbPath });
/** RFC file URL — raw `file:${windowsPath}` is not a valid URL on Windows. */
let client;
try {
  client = createClient({ url: pathToFileURL(dbPath).href });
  dbgBoot("db/index.ts", "createClient ok", { hypothesisId: "H1" });
} catch (e) {
  dbgBoot("db/index.ts", "createClient threw", {
    hypothesisId: "H1",
    err: e instanceof Error ? e.message : String(e),
  });
  throw e;
}

export const db = drizzle(client, { schema });
