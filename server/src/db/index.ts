import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as schema from "./schema.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(dir, "../../data/gym.db");
/** DB loads before server/index.ts body runs — ensure data dir exists first (fresh Docker/Fly). */
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
/** RFC file URL — raw `file:${windowsPath}` is not a valid URL on Windows. */
const client = createClient({ url: pathToFileURL(dbPath).href });

export const db = drizzle(client, { schema });
