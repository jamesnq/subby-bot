import "dotenv/config";
import { config } from "./config";
import { logger } from "./observability/logger";
import { initDiscordClient } from "./discord/client";
import { registerReady } from "./discord/events/ready";
import { registerInteractionCreate } from "./discord/events/interaction-create";
import { registerMessageCreate } from "./discord/events/message-create";
import { pingDatabase, ensurePgVectorExtension, pool } from "./database/pool";
import { startScheduler, stopScheduler } from "./jobs/scheduler";
import { startTopicScheduler, stopTopicScheduler } from "./jobs/topic-scheduler";
import { startMetricsLogger, stopMetricsLogger } from "./observability/metrics";
import { startHealthServer, stopHealthServer } from "./observability/health";
import { acquireInstanceLock } from "./observability/instance-lock";

async function main() {
  logger.info("Starting Discord AI Server Manager…");

  await acquireInstanceLock();

  await pingDatabase();
  logger.info("Database connected");
  await ensurePgVectorExtension();

  const client = initDiscordClient();
  registerReady(client);
  registerInteractionCreate(client);
  registerMessageCreate(client);

  await client.login(config.DISCORD_TOKEN);
  startScheduler(client);
  startTopicScheduler(client);
  startMetricsLogger();
  startHealthServer();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down…`);
    stopScheduler();
    stopTopicScheduler();
    stopMetricsLogger();
    stopHealthServer();
    await client.destroy().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception");
});

main().catch((err) => {
  logger.error(err, "fatal startup error");
  process.exit(1);
});

