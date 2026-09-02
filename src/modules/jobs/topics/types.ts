export type TopicHistoryMessageInput = {
  id?: string;
  content?: string | null;
  cleanContent?: string | null;
  createdTimestamp?: number;
  createdAt?: Date;
  author?: {
    id: string;
    bot?: boolean;
    username?: string | null;
  } | null;
  system?: boolean;
};

export type TopicHistoryFetchResult =
  | Iterable<TopicHistoryMessageInput>
  | {
      values(): Iterable<TopicHistoryMessageInput>;
    };

export type FetchableTopicChannel = {
  id: string;
  name: string;
  client?: {
    user?: { id: string } | null;
  } | null;
  messages: {
    fetch(options: { limit: number }): Promise<TopicHistoryFetchResult>;
  };
};

export type TopicHistoryMessage = {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
  isBot: boolean;
};

export type TopicHistorySnapshot = {
  channelId: string;
  channelName: string;
  fetchedAt: Date;
  botUserId?: string;
  messages: TopicHistoryMessage[];
  lastMessage?: TopicHistoryMessage;
  lastHumanMessage?: TopicHistoryMessage;
  lastBotMessage?: TopicHistoryMessage;
};

export type TopicHistoryAnalysis = {
  shouldSend: boolean;
  reasons: string[];
  messageCount: number;
  humanMessageCount: number;
  botMessageCount: number;
  idleMinutes: number | null;
  lastMessageByBot: boolean;
  recentHumanBurst: boolean;
  repeatedBotContent: boolean;
  dominantTopics: string[];
  keywords: string[];
  recentSummary: string;
};

export type TopicSparkContext = {
  snapshot: TopicHistorySnapshot;
  analysis: TopicHistoryAnalysis;
  prompt: string;
};

export type AnalyzeTopicHistoryOptions = {
  now?: Date;
  idleMinutes?: number;
  botCooldownMinutes?: number;
  burstWindowMinutes?: number;
  burstMessageThreshold?: number;
  maxKeywords?: number;
};

export type BuildTopicSparkPromptOptions = {
  serverName: string;
  channelName?: string;
  maxRecentMessages?: number;
};

export type PrepareTopicSparkContextOptions = AnalyzeTopicHistoryOptions &
  BuildTopicSparkPromptOptions & {
    fetchLimit?: number;
  };
