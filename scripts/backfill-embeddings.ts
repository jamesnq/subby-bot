import "dotenv/config";
import { eq, isNull, and } from "drizzle-orm";
import { db } from "../src/database/db";
import { knowledgeChunks, knowledgeEmbeddings, knowledgeDocuments } from "../src/database/schema";
import { pool } from "../src/database/pool";
import { embedTexts, isEmbeddingEnabled } from "../src/knowledge/embed";
import { logger } from "../src/observability/logger";

const BATCH_SIZE = 5;
const SLEEP_BETWEEN_BATCHES_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function backfill(guildId?: string): Promise<void> {
  if (!isEmbeddingEnabled()) {
    console.error("EMBEDDING_API_KEY chưa cấu hình — không thể backfill");
    process.exit(1);
  }

  const conditions = [isNull(knowledgeEmbeddings.embedding)];
  if (guildId) conditions.push(eq(knowledgeChunks.guildId, guildId));

  const rows = await db
    .select({
      chunkId: knowledgeChunks.id,
      content: knowledgeChunks.content,
      model: knowledgeEmbeddings.model,
    })
    .from(knowledgeEmbeddings)
    .innerJoin(knowledgeChunks, eq(knowledgeChunks.id, knowledgeEmbeddings.chunkId))
    .where(and(...conditions));

  console.log(`Cần backfill: ${rows.length} chunks`);
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await embedTexts(batch.map((b) => b.content));
      for (let j = 0; j < batch.length; j++) {
        await db
          .update(knowledgeEmbeddings)
          .set({ embedding: vectors[j], model: process.env.EMBEDDING_MODEL ?? null })
          .where(eq(knowledgeEmbeddings.chunkId, batch[j].chunkId));
      }
      done += batch.length;
      console.log(`  ✓ ${done}/${rows.length}`);
    } catch (err) {
      console.error(
        `  ✗ batch ${Math.floor(i / BATCH_SIZE) + 1} thất bại:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (i + BATCH_SIZE < rows.length) await sleep(SLEEP_BETWEEN_BATCHES_MS);
  }

  const remaining = await db
    .select({ count: knowledgeChunks.chunkIndex })
    .from(knowledgeEmbeddings)
    .innerJoin(knowledgeChunks, eq(knowledgeChunks.id, knowledgeEmbeddings.chunkId))
    .where(isNull(knowledgeEmbeddings.embedding));
  console.log(`Hoàn tất. Còn thiếu vector: ${remaining.length}`);

  void knowledgeDocuments;
}

const guildArg = process.argv[2] && /^\d{17,20}$/.test(process.argv[2]) ? process.argv[2] : undefined;
backfill(guildArg)
  .then(() => pool.end())
  .catch((e) => {
    logger.error(e);
    process.exit(1);
  });
