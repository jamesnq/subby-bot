import type { Client } from "discord.js";

import { startPaymentPolling, stopPaymentPolling } from "../modules/payments/service";
import { config } from "@config";
import { db } from "@database/db";
import { pingDatabase, pool } from "@infra/database/pool";
import { initDiscordClient } from "@infra/discord/client";
import { registerInteractionCreate } from "@discord/events/interaction-create";
import { registerReady } from "@discord/events/ready";
import { startHealthServer, stopHealthServer } from "@observability/health";
import { acquireInstanceLock } from "@observability/instance-lock";
import { logger } from "@shared/logger";

import { TOKENS } from "./container";
import type { Module } from "./modules";

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
    startHealthServer();
  },
  shutdown() {
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
  },
  async bootstrap(container) {
    const client = container.resolve<Client>(TOKENS.DiscordClient);
    await client.login(config.DISCORD_TOKEN);
    startPaymentPolling(client);
  },
  async shutdown(container) {
    const client = container.resolve<Client>(TOKENS.DiscordClient);
    stopPaymentPolling();
    await client.destroy().catch(() => undefined);
  },
};

export const modules: Module[] = [
  configModule,
  loggerModule,
  runtimeModule,
  databaseModule,
  observabilityModule,
  discordModule,
];
