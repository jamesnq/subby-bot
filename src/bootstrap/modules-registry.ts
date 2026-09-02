import type { Client } from "discord.js";

import { config } from "@config";
import { db } from "@database/db";
import { ensurePgVectorExtension, pingDatabase, pool } from "@infra/database/pool";
import { getDiscordClient, initDiscordClient } from "@infra/discord/client";
import { registerInteractionCreate } from "@discord/events/interaction-create";
import { registerMessageCreate } from "@discord/events/message-create";
import { registerReady } from "@discord/events/ready";
import { startScheduler, stopScheduler } from "@jobs/scheduler";
import { startTopicScheduler, stopTopicScheduler } from "@jobs/topic-scheduler";
import { startHealthServer, stopHealthServer } from "@observability/health";
import { acquireInstanceLock } from "@observability/instance-lock";
import { logger } from "@shared/logger";
import { startMetricsLogger, stopMetricsLogger } from "@observability/metrics";

import { TOKENS, type Container } from "./container";
import type { Module } from "./modules";

/**
 * Every module below does real work. A module that would only exist to hold a
 * name is not registered at all - an empty `register()` buys nothing but an
 * edge in the dependency sort.
 *
 * Imports are static on purpose. Resolving dependencies through `require()`
 * inside `register()` hides the wiring from the type checker, which is the
 * main thing this container is supposed to make safe.
 */

const configModule: Module = {
  name: "config",
  dependencies: [],
  register(container) {
    container.registerSingleton(TOKENS.Config, config);
  },
};

const loggerModule: Module = {
  name: "logger",
  dependencies: ["config"],
  register(container) {
    container.registerSingleton(TOKENS.Logger, logger);
  },
};

/**
 * Holds the single-instance guard. The old entry point took this lock before
 * touching the database, and it must stay that way: the in-memory rate limits,
 * session locks and daily code quotas are all per-process, so a second live
 * instance silently doubles every one of them.
 */
const runtimeModule: Module = {
  name: "runtime",
  dependencies: ["config", "logger"],
  register() {},
  async bootstrap() {
    await acquireInstanceLock();
  },
};

const databaseModule: Module = {
  name: "database",
  dependencies: ["config", "logger", "runtime"],
  register(container) {
    container.registerSingleton(TOKENS.Database, { db, pool });
  },
  async bootstrap() {
    await pingDatabase();
    logger.info("Database connected");
    await ensurePgVectorExtension();
  },
  async shutdown() {
    await pool.end().catch(() => undefined);
  },
};

const observabilityModule: Module = {
  name: "observability",
  dependencies: ["config", "logger"],
  register() {},
  bootstrap() {
    startMetricsLogger();
    startHealthServer();
  },
  shutdown() {
    stopMetricsLogger();
    stopHealthServer();
  },
};

const discordModule: Module = {
  name: "discord",
  dependencies: ["config", "logger", "database", "observability"],
  register(container) {
    const client = initDiscordClient();
    container.registerSingleton(TOKENS.DiscordClient, client);

    registerReady(client);
    registerInteractionCreate(client);
    registerMessageCreate(client);
  },
  async bootstrap(container) {
    const client = container.resolve<Client>(TOKENS.DiscordClient);
    await client.login(config.DISCORD_TOKEN);
  },
  async shutdown(container) {
    const client = container.resolve<Client>(TOKENS.DiscordClient);
    await client.destroy().catch(() => undefined);
  },
};

const schedulerModule: Module = {
  name: "scheduler",
  dependencies: ["discord", "database", "logger"],
  register() {},
  bootstrap() {
    const client = getDiscordClient();
    startScheduler(client);
    startTopicScheduler(client);
  },
  shutdown() {
    stopScheduler();
    stopTopicScheduler();
  },
};

export const modules: Module[] = [
  configModule,
  loggerModule,
  runtimeModule,
  databaseModule,
  observabilityModule,
  discordModule,
  schedulerModule,
];
