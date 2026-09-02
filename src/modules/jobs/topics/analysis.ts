import {
  DEFAULT_BOT_COOLDOWN_MINUTES,
  DEFAULT_BURST_MESSAGE_THRESHOLD,
  DEFAULT_BURST_WINDOW_MINUTES,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_MAX_KEYWORDS,
  TOPIC_PATTERNS,
} from "./constants";
import { extractKeywords, normalizeForRepeat } from "./text";
import type {
  AnalyzeTopicHistoryOptions,
  TopicHistoryAnalysis,
  TopicHistoryMessage,
  TopicHistorySnapshot,
} from "./types";

export function analyzeTopicHistory(
  snapshot: TopicHistorySnapshot,
  options: AnalyzeTopicHistoryOptions = {},
): TopicHistoryAnalysis {
  const now = options.now ?? snapshot.fetchedAt;
  const idleMinutes = options.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const botCooldownMinutes = options.botCooldownMinutes ?? DEFAULT_BOT_COOLDOWN_MINUTES;
  const burstWindowMinutes = options.burstWindowMinutes ?? DEFAULT_BURST_WINDOW_MINUTES;
  const burstMessageThreshold = options.burstMessageThreshold ?? DEFAULT_BURST_MESSAGE_THRESHOLD;
  const maxKeywords = options.maxKeywords ?? DEFAULT_MAX_KEYWORDS;

  const lastMessage = snapshot.lastMessage;
  const observedIdleMinutes = lastMessage
    ? Math.max(0, (now.getTime() - lastMessage.createdAt.getTime()) / 60_000)
    : null;
  const lastMessageByBot = Boolean(lastMessage?.isBot);
  const recentBotMessage = snapshot.lastBotMessage
    ? now.getTime() - snapshot.lastBotMessage.createdAt.getTime() < botCooldownMinutes * 60_000
    : false;
  const recentHumanBurst = countHumanMessagesSince(snapshot, now, burstWindowMinutes) >= burstMessageThreshold;
  const repeatedBotContent = hasRepeatedBotContent(snapshot);

  const reasons: string[] = [];
  if (observedIdleMinutes !== null && observedIdleMinutes < idleMinutes) {
    reasons.push("channel_not_idle");
  }
  if (lastMessageByBot) reasons.push("last_message_from_bot");
  if (recentBotMessage) reasons.push("recent_bot_message");
  if (recentHumanBurst) reasons.push("recent_human_burst");
  if (repeatedBotContent) reasons.push("repeated_bot_content");

  const humanMessages = snapshot.messages.filter((message) => !message.isBot);
  const botMessages = snapshot.messages.filter((message) => message.isBot);
  const keywords = extractKeywords(humanMessages.map((message) => message.content).join(" "), maxKeywords);
  const dominantTopics = inferDominantTopics(humanMessages);

  return {
    shouldSend: reasons.length === 0,
    reasons,
    messageCount: snapshot.messages.length,
    humanMessageCount: humanMessages.length,
    botMessageCount: botMessages.length,
    idleMinutes: observedIdleMinutes,
    lastMessageByBot,
    recentHumanBurst,
    repeatedBotContent,
    dominantTopics,
    keywords,
    recentSummary: summarizeRecentHistory(snapshot),
  };
}

function countHumanMessagesSince(
  snapshot: TopicHistorySnapshot,
  now: Date,
  windowMinutes: number,
): number {
  const threshold = now.getTime() - windowMinutes * 60_000;
  return snapshot.messages.filter(
    (message) => !message.isBot && message.createdAt.getTime() >= threshold,
  ).length;
}

function hasRepeatedBotContent(snapshot: TopicHistorySnapshot): boolean {
  const seen = new Set<string>();
  for (const message of snapshot.messages.filter((item) => item.isBot)) {
    const normalized = normalizeForRepeat(message.content);
    if (normalized.length < 12) continue;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

function inferDominantTopics(messages: TopicHistoryMessage[]): string[] {
  const scores = new Map<string, number>();
  for (const message of messages) {
    for (const topic of TOPIC_PATTERNS) {
      if (topic.patterns.some((pattern) => pattern.test(message.content))) {
        scores.set(topic.topic, (scores.get(topic.topic) ?? 0) + 1);
      }
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([topic]) => topic);
}

function summarizeRecentHistory(snapshot: TopicHistorySnapshot): string {
  const humanMessages = snapshot.messages.filter((message) => !message.isBot);
  if (humanMessages.length === 0) return "Chua co tin nhan thanh vien trong lich su lay duoc.";

  const latest = humanMessages[0];
  const older = humanMessages.slice(1, 4);
  const parts = [`Tin moi nhat cua thanh vien: "${latest.content}"`];
  if (older.length > 0) {
    parts.push(`Truoc do co nhac den: ${older.map((message) => `"${message.content}"`).join("; ")}`);
  }
  return parts.join(" ");
}
