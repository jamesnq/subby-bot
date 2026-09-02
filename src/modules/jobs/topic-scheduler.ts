import { ChannelType, type Client, type Guild, type TextChannel } from "discord.js";
import { and, eq, gte, sql } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "@config";
import { db } from "../database/db";
import { auditLogs } from "../database/schema";
import { getGuildSettings, listAllowedChannels } from "../discord/permissions/guard";
import { getSmallModel, invokeTracked } from "../agent/llm";
import { TOPIC_SPARK_PROMPT } from "../agent/prompts";
import { writeAudit } from "../database/audit";
import { logger } from "@shared/logger";
import { prepareTopicSparkContext } from "./topic-history";

const TICK_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startTopicScheduler(client: Client): void {
  if (!config.PROACTIVE_TOPIC_ENABLED || !config.AI_ASSISTANT_ENABLED) {
    logger.info("proactive topic scheduler disabled");
    return;
  }
  if (timer) return;
  timer = setInterval(() => void tickTopics(client), TICK_INTERVAL_MS);
  logger.info(
    {
      intervalMinutes: config.PROACTIVE_TOPIC_INTERVAL_MINUTES,
      maxPerGuildDay: config.PROACTIVE_TOPIC_MAX_PER_GUILD_DAY,
      idleMinutes: config.PROACTIVE_TOPIC_IDLE_MINUTES,
    },
    "proactive topic scheduler started",
  );
}

export function stopTopicScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function minutesOfDay(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function isQuietHour(now: Date): boolean {
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const start = minutesOfDay(config.PROACTIVE_TOPIC_QUIET_START);
  const end = minutesOfDay(config.PROACTIVE_TOPIC_QUIET_END);
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

async function topicsSentToday(guildId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.guildId, guildId),
        eq(auditLogs.action, "proactive.topic_sent"),
        gte(auditLogs.createdAt, dayStart),
      ),
    );
  return rows[0]?.n ?? 0;
}

async function tickTopics(client: Client): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    if (isQuietHour(new Date())) return;

    const lastTickByGuild = tickTopics as unknown as { _last?: Map<string, number> };
    if (!lastTickByGuild._last) lastTickByGuild._last = new Map();
    const lastMap = lastTickByGuild._last;

    for (const guild of client.guilds.cache.values()) {
      const last = lastMap.get(guild.id) ?? 0;
      const elapsedMin = (Date.now() - last) / 60_000;
      if (elapsedMin < config.PROACTIVE_TOPIC_INTERVAL_MINUTES) continue;
      lastMap.set(guild.id, Date.now());
      try {
        await sparkTopicInGuild(guild);
      } catch (err) {
        logger.warn({ err, guildId: guild.id }, "topic spark failed");
      }
      await sleep(Math.floor(Math.random() * 20_000));
    }
  } finally {
    busy = false;
  }
}

function canBotSendIn(channel: TextChannel): boolean {
  const me = channel.guild.members.me;
  if (!me) return false;
  return (
    channel.permissionsFor(me).has("ViewChannel") &&
    channel.permissionsFor(me).has("SendMessages")
  );
}

async function pickTargetChannel(guild: Guild): Promise<TextChannel | null> {
  const settings = await getGuildSettings(guild.id);
  let candidates: TextChannel[] = [];

  if (settings.allChannels) {
    candidates = [...guild.channels.cache.values()].filter(
      (c): c is TextChannel => c.type === ChannelType.GuildText && canBotSendIn(c),
    );
  } else {
    const allowedIds = await listAllowedChannels(guild.id);
    candidates = allowedIds
      .map((id) => guild.channels.cache.get(id))
      .filter((c): c is TextChannel => Boolean(c) && (c as TextChannel).type === ChannelType.GuildText && canBotSendIn(c as TextChannel));
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function sparkTopicInGuild(guild: Guild): Promise<void> {
  const settings = await getGuildSettings(guild.id);
  if (!settings.enabled) return;
  if ((await topicsSentToday(guild.id)) >= config.PROACTIVE_TOPIC_MAX_PER_GUILD_DAY) return;

  const channel = await pickTargetChannel(guild);
  if (!channel) return;

  const topicContext = await prepareTopicSparkContext(channel, {
    serverName: guild.name,
    idleMinutes: config.PROACTIVE_TOPIC_IDLE_MINUTES,
    botCooldownMinutes: config.PROACTIVE_TOPIC_INTERVAL_MINUTES,
    fetchLimit: config.PROACTIVE_TOPIC_HISTORY_LIMIT,
  }).catch((err) => {
    logger.warn({ err, guildId: guild.id, channelId: channel.id }, "topic history fetch failed");
    return null;
  });
  if (!topicContext?.analysis.shouldSend) return;

  const response = await invokeTracked(getSmallModel(), guild.id, [
    new SystemMessage(TOPIC_SPARK_PROMPT),
    new HumanMessage(topicContext.prompt),
  ]);
  const text =
    (typeof response.content === "string" ? response.content : "")
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .slice(0, 500);
  if (text.length < 10) return;

  await channel.send({ content: text, allowedMentions: { parse: [] } });
  await writeAudit({
    guildId: guild.id,
    actorId: channel.client.user?.id ?? "system",
    actorType: "system",
    action: "proactive.topic_sent",
    targetType: "channel",
    targetId: channel.id,
    details: {
      preview: text.slice(0, 120),
      historyMessages: topicContext.analysis.messageCount,
      dominantTopics: topicContext.analysis.dominantTopics,
    },
  });
  logger.info({ guildId: guild.id, channelId: channel.id }, "proactive topic sent");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
