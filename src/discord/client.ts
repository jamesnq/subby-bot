import { Client, GatewayIntentBits } from "discord.js";

let client: Client | null = null;

export function initDiscordClient(): Client {
  if (client) return client;
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  return client;
}

export function getDiscordClient(): Client {
  if (!client) throw new Error("Discord client chưa được khởi tạo");
  return client;
}
