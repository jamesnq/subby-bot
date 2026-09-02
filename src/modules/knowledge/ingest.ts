import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../database/db";
import {
  faqCache,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeEmbeddings,
} from "../database/schema";
import { splitIntoChunks } from "./chunk";
import { csvToKnowledgeText } from "./csv";
import { stripDiacritics } from "./keywords";
import { embedTexts, isEmbeddingEnabled } from "./embed";
import { logger } from "@shared/logger";

export type IngestVisibility = "public" | "member" | "staff";

export type IngestOptions = {
  guildId: string;
  visibility: IngestVisibility;
  allowedRoleIds: string[];
  sourceType?: string;
};

export async function ingestDocument(
  title: string,
  content: string,
  options: IngestOptions,
): Promise<{ documentId: string; chunkCount: number; version: number }> {
  const checksum = createHash("sha256").update(content).digest("hex");

  const existing = await db.select()
    .from(knowledgeDocuments)
    .where(
      and(eq(knowledgeDocuments.guildId, options.guildId), eq(knowledgeDocuments.title, title)),
    );

  const version = existing.length > 0 ? Math.max(...existing.map((d) => d.version)) + 1 : 1;

  const [doc] = await db.insert(knowledgeDocuments)
    .values({
      guildId: options.guildId,
      title,
      sourceType: options.sourceType ?? "manual",
      visibility: options.visibility,
      allowedRoleIds: options.allowedRoleIds,
      version,
      checksum,
    })
    .returning();

  const chunks = splitIntoChunks(content);
  if (chunks.length === 0) {
    return { documentId: doc.id, chunkCount: 0, version };
  }

  const inserted = await db.insert(knowledgeChunks)
    .values(
      chunks.map((content_, index) => ({
        documentId: doc.id,
        guildId: options.guildId,
        chunkIndex: index,
        content: content_,
        contentSearch: stripDiacritics(content_),
      })),
    )
    .returning({ id: knowledgeChunks.id });

  for (const row of inserted) {
    await db.insert(knowledgeEmbeddings).values({ chunkId: row.id });
  }

  if (isEmbeddingEnabled()) {
    try {
      const vectors = await embedTexts(chunks);
      for (let i = 0; i < inserted.length; i++) {
        await db
          .update(knowledgeEmbeddings)
          .set({ embedding: vectors[i], model: process.env.EMBEDDING_MODEL ?? null })
          .where(eq(knowledgeEmbeddings.chunkId, inserted[i].id));
      }
      logger.info({ title, vectors: vectors.length }, "chunk embeddings stored");
    } catch (err) {
      logger.warn({ err }, "embedding indexing failed, full-text search still works");
    }
  }

  await db.delete(faqCache).where(eq(faqCache.guildId, options.guildId));

  if (existing.length > 0) {
    await db.delete(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.guildId, options.guildId),
          eq(knowledgeDocuments.title, title),
          ne(knowledgeDocuments.id, doc.id),
        ),
      );
  }

  logger.info({ title, version, chunks: chunks.length }, "knowledge ingested");
  return { documentId: doc.id, chunkCount: chunks.length, version };
}

export async function ingestDirectory(dirPath: string, options: IngestOptions) {
  const files = (await readdir(dirPath)).filter((f) =>
    [".md", ".txt", ".csv"].includes(path.extname(f).toLowerCase()),
  );
  const results: { file: string; chunkCount: number; version: number }[] = [];

  for (const file of files) {
    const full = path.join(dirPath, file);
    const raw = await readFile(full, "utf8");
    const isCsv = path.extname(file).toLowerCase() === ".csv";
    const content = isCsv ? csvToKnowledgeText(raw) : raw;
    const titleMatch = /^#\s+(.+)$/m.exec(content);
    const title = titleMatch?.[1]?.trim() ?? path.basename(file, path.extname(file));
    const res = await ingestDocument(title, content, {
      ...options,
      sourceType: isCsv ? "product" : "manual",
    });
    results.push({ file, chunkCount: res.chunkCount, version: res.version });
  }
  return results;
}


