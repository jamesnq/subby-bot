export type {
  AnalyzeTopicHistoryOptions,
  BuildTopicSparkPromptOptions,
  FetchableTopicChannel,
  PrepareTopicSparkContextOptions,
  TopicHistoryAnalysis,
  TopicHistoryFetchResult,
  TopicHistoryMessage,
  TopicHistoryMessageInput,
  TopicHistorySnapshot,
  TopicSparkContext,
} from "./topics/types";
export {
  buildTopicHistorySnapshot,
  fetchRecentTopicHistory,
} from "./topics/history";
export { analyzeTopicHistory } from "./topics/analysis";
export {
  buildTopicSparkHumanPrompt,
  prepareTopicSparkContext,
} from "./topics/prompt";
