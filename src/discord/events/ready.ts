import { Events, type Client } from "discord.js";
import { logger } from "../../observability/logger";

export function registerReady(client: Client): void {
  client.once(Events.ClientReady, (c) => {
    logger.info(`Logged in as ${c.user.tag} in ${c.guilds.cache.size} guild(s)`);
  });
}
