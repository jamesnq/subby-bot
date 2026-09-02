import type { Client } from "discord.js";

import { config } from "@config";
import {
  configureCodeAccessDailyLimitStore,
  PostgresCodeAccessDailyLimitStore,
} from "@code-access/limits";
import { db } from "@database/db";
import {
  configureConversationSessionStore,
  PostgresConversationSessionStore,
  sessionStoreOptions,
} from "@discord/session";
import { ensurePgVectorExtension, pingDatabase, pool } from "@infra/database/pool";
import { getDiscordClient, initDiscordClient } from "@infra/discord/client";
import { registerInteractionCreate } from "@discord/events/interaction-create";
import { registerMessageCreate } from "@discord/events/message-create";
import { registerReady } from "@discord/events/ready";
import { startScheduler, stopScheduler } from "@jobs/scheduler";
import { startTopicScheduler, stopTopicScheduler } from "@jobs/topic-scheduler";
import { startHealthServer, stopHealthServer } from "@observability/health";
import { acquireInstanceLock } from "@observability/instance-lock";
import { configureRateLimitStore, PostgresRateLimitStore } from "@policies/rate-limit";
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

/**
 * Rate limits, the /code daily quota, and conversation sessions default to
 * an in-process Map, which is fine for one instance but silently doubles
 * every limit - and lets a locked session look free - the moment a second
 * one runs. STATE_BACKEND=postgres swaps all three for the shared tables in
 * drizzle/0007_shared_state.sql and drizzle/0008_conversation_session_fields.sql.
 * Wiring lives here, after the database is up, rather than at each module's
 * import time, so the choice is explicit and the memory default needs no
 * config at all.
 */
const stateModule: Module = {
  name: "state",
  dependencies: ["config", "logger", "database"],
  register() {
    if (config.STATE_BACKEND !== "postgres") return;

    configureRateLimitStore(new PostgresRateLimitStore());
    configureCodeAccessDailyLimitStore(new PostgresCodeAccessDailyLimitStore());
    configureConversationSessionStore(new PostgresConversationSessionStore(sessionStoreOptions));
    logger.info("Using Postgres-backed rate limit, daily quota, and session stores");
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
  stateModule,
  observabilityModule,
  discordModule,
  schedulerModule,
];
