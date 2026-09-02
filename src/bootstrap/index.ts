import "dotenv/config";

import { logger } from "@shared/logger";

import { createContainer, type Container } from "./container";
import { ModuleRegistry } from "./modules";
import { modules } from "./modules-registry";

export type App = {
  container: Container;
  shutdown: () => Promise<void>;
};

/**
 * Builds a fully wired application. The registry is created per call rather
 * than shared as a module singleton so that a second createApp() - in a test,
 * say - does not fail with "Module already registered".
 */
export async function createApp(): Promise<App> {
  const container = createContainer();
  const registry = new ModuleRegistry();

  for (const module of modules) {
    registry.register(module);
  }

  await registry.registerAll(container);
  await registry.bootstrapAll(container);

  return {
    container,
    shutdown: () => registry.shutdownAll(container),
  };
}

export async function bootstrap(): Promise<void> {
  logger.info("Starting Discord AI Server Manager…");

  const app = await createApp();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received, shutting down…`);
    await app.shutdown().catch((err) => {
      logger.error({ err }, "error during shutdown");
    });
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * These stay non-fatal on purpose. A transient Discord 5xx surfacing as an
 * unhandled rejection must not take the whole bot down.
 */
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception");
});

export { container, createContainer, TOKENS } from "./container";
export { defineModule, ModuleRegistry, moduleRegistry } from "./modules";
export { modules } from "./modules-registry";
