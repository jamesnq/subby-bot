import "dotenv/config";
import { eq, isNull, and } from "drizzle-orm";
import { db } from "../src/modules/database/db";
import { knowledgeChunks, knowledgeEmbeddings } from "../src/modules/database/schema";
import { ensurePgVectorExtension, pool } from "@infra/database/pool";
import { embedTexts, isEmbeddingEnabled } from "../src/modules/knowledge/embed";
import { stripDiacritics } from "../src/modules/knowledge/keywords";
import { logger } from "@shared/logger";

const EMBED_BATCH = 1;
const SLEEP_MS = 6_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await ensurePgVectorExtension();

  const chunksNeedingSearch = await db
    .select({ id: knowledgeChunks.id, content: knowledgeChunks.content })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.contentSearch, ""));

  for (const c of chunksNeedingSearch) {
    await db
      .update(knowledgeChunks)
      .set({ contentSearch: stripDiacritics(c.content) })
      .where(eq(knowledgeChunks.id, c.id));
  }
  console.log(`content_search updated: ${chunksNeedingSearch.length} rows`);

  if (!isEmbeddingEnabled()) {
    console.log("EMBEDDING_API_KEY không có — bỏ qua backfill vector");
    await pool.end();
    return;
  }

  const missingVectors = await db
    .select({
      chunkId: knowledgeEmbeddings.chunkId,
      content: knowledgeChunks.content,
    })
    .from(knowledgeEmbeddings)
    .innerJoin(knowledgeChunks, eq(knowledgeChunks.id, knowledgeEmbeddings.chunkId))
    .where(and(isNull(knowledgeEmbeddings.embedding)));

  console.log(`chunks thiếu vector: ${missingVectors.length}`);
  let done = 0;

  for (let i = 0; i < missingVectors.length; i += EMBED_BATCH) {
    const batch = missingVectors.slice(i, i + EMBED_BATCH);
    try {
      const vectors = await embedTexts(batch.map((b) => b.content.slice(0, 1500)));
      for (let j = 0; j < batch.length; j++) {
        await db
          .update(knowledgeEmbeddings)
          .set({ embedding: vectors[j], model: process.env.EMBEDDING_MODEL ?? null })
          .where(eq(knowledgeEmbeddings.chunkId, batch[j].chunkId));
      }
      done += batch.length;
      console.log(`  ✓ embeddings ${done}/${missingVectors.length}`);
    } catch (err) {
      logger.error({ err }, "embed batch failed");
    }
    if (i + EMBED_BATCH < missingVectors.length) await sleep(SLEEP_MS);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

