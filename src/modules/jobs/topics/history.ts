import { DEFAULT_FETCH_LIMIT } from "./constants";
import { clampInt, sanitizeAuthorName, sanitizeHistoryContent } from "./text";
import type {
  FetchableTopicChannel,
  TopicHistoryFetchResult,
  TopicHistoryMessage,
  TopicHistoryMessageInput,
  TopicHistorySnapshot,
} from "./types";

export async function fetchRecentTopicHistory(
  channel: FetchableTopicChannel,
  options: { limit?: number; now?: Date } = {},
): Promise<TopicHistorySnapshot> {
  const limit = clampInt(options.limit ?? DEFAULT_FETCH_LIMIT, 1, 100);
  const fetched = await channel.messages.fetch({ limit });
  const botUserId = channel.client?.user?.id;
  const messages = Array.from(fetchResultValues(fetched))
    .map((message) => normalizeMessage(message, botUserId))
    .filter((message): message is TopicHistoryMessage => message !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return buildTopicHistorySnapshot({
    channelId: channel.id,
    channelName: channel.name,
    botUserId,
    fetchedAt: options.now ?? new Date(),
    messages,
  });
}

export function buildTopicHistorySnapshot(input: {
  channelId: string;
  channelName: string;
  fetchedAt?: Date;
  botUserId?: string;
  messages: TopicHistoryMessage[];
}): TopicHistorySnapshot {
  const messages = [...input.messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    channelId: input.channelId,
    channelName: input.channelName,
    fetchedAt: input.fetchedAt ?? new Date(),
    botUserId: input.botUserId,
    messages,
    lastMessage: messages[0],
    lastHumanMessage: messages.find((message) => !message.isBot),
    lastBotMessage: messages.find((message) => message.isBot),
  };
}

function normalizeMessage(
  message: TopicHistoryMessageInput,
  botUserId: string | undefined,
): TopicHistoryMessage | null {
  if (message.system) return null;
  const rawContent = message.cleanContent ?? message.content ?? "";
  const content = sanitizeHistoryContent(rawContent);
  if (!content) return null;

  const timestamp = getMessageTimestamp(message);
  if (timestamp === null) return null;

  const authorId = message.author?.id ?? "unknown";
  return {
    id: message.id ?? `${authorId}:${timestamp}`,
    authorId,
    authorName: sanitizeAuthorName(message.author?.username ?? "member"),
    content,
    createdAt: new Date(timestamp),
    isBot: Boolean(message.author?.bot) || Boolean(botUserId && authorId === botUserId),
  };
}

function fetchResultValues(fetched: TopicHistoryFetchResult): Iterable<TopicHistoryMessageInput> {
  if ("values" in fetched && typeof fetched.values === "function") {
    return fetched.values();
  }
  return fetched as Iterable<TopicHistoryMessageInput>;
}

function getMessageTimestamp(message: TopicHistoryMessageInput): number | null {
  if (typeof message.createdTimestamp === "number" && Number.isFinite(message.createdTimestamp)) {
    return message.createdTimestamp;
  }
  if (message.createdAt instanceof Date && Number.isFinite(message.createdAt.getTime())) {
    return message.createdAt.getTime();
  }
  return null;
}
