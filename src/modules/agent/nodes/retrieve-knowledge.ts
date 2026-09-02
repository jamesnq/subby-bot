import { config } from "@config";
import { logger } from "@shared/logger";
import { searchKnowledge } from "../../knowledge/retrieve";
import { embedQuery, isEmbeddingEnabled } from "../../knowledge/embed";
import { lookupCachedAnswer } from "../../knowledge/cache";
import type { AgentState } from "../state";

export async function retrieveKnowledge(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const cached = await lookupCachedAnswer(state.guildId, state.input, state.memberRoleIds);
    if (cached) {
      return { cachedAnswer: cached.answer };
    }

    const queryEmbedding = await embedQuery(state.input);
    const chunks = await searchKnowledge(state.guildId, state.input, {
      limit: 6,
      memberRoleIds: state.memberRoleIds,
      queryEmbedding,
    });
    // Fulltext ts_rank scores are far lower than vector cosine scores; without
    // embeddings the configured threshold would filter out almost everything.
    const threshold = isEmbeddingEnabled() && queryEmbedding
      ? config.KNOWLEDGE_SCORE_THRESHOLD
      : Math.min(config.KNOWLEDGE_SCORE_THRESHOLD, 0.05);
    const filtered = chunks.filter((c) => c.score >= threshold);
    return { retrievedContext: filtered };
  } catch (err) {
    logger.warn({ err, guildId: state.guildId }, "knowledge retrieval failed - answering without context");
    return { retrievedContext: [] };
  }
}
