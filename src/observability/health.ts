import http from "node:http";
import { config } from "../config";
import { logger } from "./logger";

let server: http.Server | null = null;

export function startHealthServer(uptimeSince = Date.now()): void {
  if (!process.env.HEALTH_PORT) return;
  const port = Number(process.env.HEALTH_PORT);

  server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          uptimeSeconds: Math.round((Date.now() - uptimeSince) / 1000),
          env: process.env.NODE_ENV ?? "development",
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => logger.info(`health server on :${port}`));
}

export function stopHealthServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
