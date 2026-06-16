import { dbgBoot } from "./debugBoot.js";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHttpRoutes } from "./http/routes.js";
import { registerWebSocket } from "./http/ws.js";

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, "../data"), { recursive: true });

const repoRoot = path.join(here, "../..");
const webDist = path.join(repoRoot, "web/dist");
if (!fs.existsSync(webDist)) {
  throw new Error(
    `Missing frontend build at ${webDist}. Run "npm run build" from the repo root (includes @gym/web) before production start.`,
  );
}
dbgBoot("index.ts", "webDist ok", { hypothesisId: "H3", webDist });

const app = Fastify({ logger: true });
await app.register(cors, { origin: true, credentials: true });

dbgBoot("index.ts", "before registerHttpRoutes", { hypothesisId: "H1" });
await registerHttpRoutes(app);
await registerWebSocket(app);

await app.register(staticPlugin, {
  root: webDist,
  decorateReply: false,
});

app.setNotFoundHandler((req, reply) => {
  const url = req.raw.url ?? "";
  if (url.startsWith("/api") || url.startsWith("/ws")) {
    return reply.code(404).send({ error: "Not found" });
  }
  return reply.type("text/html").send(fs.readFileSync(path.join(webDist, "index.html"), "utf8"));
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
dbgBoot("index.ts", "before listen", { hypothesisId: "H2", port, host, PORT: process.env.PORT });
await app.listen({ port, host });
dbgBoot("index.ts", "after listen", { hypothesisId: "H2", port, host });
console.log(`Gym judging server http://${host}:${port}`);
// #region agent log
void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
  body: JSON.stringify({
    sessionId: "5f3141",
    location: "server/index.ts:listen",
    message: "server listen ok",
    data: { port, host },
    timestamp: Date.now(),
    hypothesisId: "H2",
  }),
}).catch(() => {});
// #endregion
