import { REST, Routes, type RESTGetAPIApplicationCommandsResult } from "discord.js";
import "dotenv/config";
import { config } from "@config";
import { logger } from "@shared/logger";
import { codeCommand } from "./commands/code";
import { codeAdminCommand, codeWhitelistCommand } from "./commands/code-admin";

async function main() {
  const rest = new REST().setToken(config.DISCORD_TOKEN);
  const app = config.DISCORD_CLIENT_ID;
  const route = Routes.applicationCommands(app);
  const commands = await rest.get(route) as RESTGetAPIApplicationCommandsResult;
  for (const definition of [codeCommand, codeAdminCommand, codeWhitelistCommand]) {
    const existing = commands.find(command => command.type === 1 && command.name === definition.name)
      ?? (definition === codeCommand ? commands.find(command => command.type === 1 && command.name === "code") : undefined);
    if (existing) {
      await rest.patch(Routes.applicationCommand(app, existing.id), { body: definition.toJSON() });
    } else {
      await rest.post(route, { body: definition.toJSON() });
    }
  }
  for (const command of commands.filter(command => command.type === 1 && command.name === "code")) {
    const renamed = !commands.some(other => other.name === codeCommand.name && other.type === 1);
    if (!renamed) await rest.delete(Routes.applicationCommand(app, command.id));
  }
  // Remove only the old guild /code, which would shadow the global version.
  if (config.DISCORD_GUILD_ID) {
    const guildCommands = await rest.get(Routes.applicationGuildCommands(app, config.DISCORD_GUILD_ID)) as RESTGetAPIApplicationCommandsResult;
    for (const command of guildCommands.filter(command => ["code", codeCommand.name, codeAdminCommand.name, codeWhitelistCommand.name].includes(command.name) && command.type === 1)) {
      await rest.delete(Routes.applicationGuildCommand(app, config.DISCORD_GUILD_ID, command.id));
    }
  }
  const verified = await rest.get(route) as RESTGetAPIApplicationCommandsResult;
  const code = verified.find(command => command.name === codeCommand.name && command.type === 1);
  logger.info({ contexts: code?.contexts }, "Registered /code_reseller, /code_admin and /code_whitelist");
}
main().catch(err => {
  logger.error(err, "failed to register commands");
  process.exit(1);
});
