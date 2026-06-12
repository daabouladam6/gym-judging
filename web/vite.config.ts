import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** #region agent log */
function debugDevListenPlugin(): import("vite").Plugin {
  return {
    name: "debug-dev-listen",
    configureServer(server) {
      const logPath = path.resolve(__dirname, "../debug-5f3141.log");
      const send = (payload: Record<string, unknown>) => {
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(payload),
        }).catch(() => {});
        try {
          fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`);
        } catch {
          /* ignore */
        }
      };

      server.httpServer?.once("error", (err: NodeJS.ErrnoException) => {
        send({
          sessionId: "5f3141",
          hypothesisId: "H2",
          location: "vite.config.ts:httpServer.error",
          message: "vite httpServer error (e.g. port in use)",
          data: { code: err.code, message: err.message },
          timestamp: Date.now(),
          runId: "pre-fix",
        });
      });

      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        send({
          sessionId: "5f3141",
          hypothesisId: "H3",
          location: "vite.config.ts:debugDevListenPlugin",
          message: "vite dev server listening",
          data: { address: addr, port: typeof addr === "object" && addr ? addr.port : null },
          timestamp: Date.now(),
          runId: "pre-fix",
        });
      });
    },
  };
}
/** #endregion */

export default defineConfig({
  plugins: [react(), debugDevListenPlugin()],
  server: {
    // Bind IPv4 explicitly — some Windows setups resolve `localhost` to IPv6 ::1 while
    // Vite only listened on IPv4, which yields ERR_CONNECTION_REFUSED (-102).
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Open app root (logged-out users redirect to /login in the SPA).
    open: "/",
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
});
