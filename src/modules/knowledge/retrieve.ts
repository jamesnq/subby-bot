import { sql } from "drizzle-orm";
import { pool } from "@infra/database/pool";
import { extractKeywords, stripDiacritics } from "./keywords";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceType: string;
  score: number;
};

export type SearchOptions = {
  limit?: number;
  memberRoleIds?: string[];
  queryEmbedding?: number[];
};

type Row = {
  chunk_id: string;
  document_id: string;
  title: string;
  content: string;
  source_type: string;
  score: number;
};

function isProductLookupQuery(query: string): boolean {
  const normalized = stripDiacritics(query);
  return /\b(gia|nap|coin|code|codes|mua|goi)\b/.test(normalized);
}

async function fulltextSearch(
  guildId: string,
  query: string,
  roleIds: string[],
  limit: number,
): Promise<Row[]> {
  const { tokens, orQuery } = extractKeywords(query);
  const tokenArray = tokens.length > 0 ? tokens : [stripDiacritics(query).trim()].filter(Boolean);

  const result = await pool.query<Row>(
    `WITH q AS (SELECT websearch_to_tsquery('simple', $5) AS tsq),
         tok AS (SELECT unnest($3::text[]) AS t)
     SELECT kc.id AS chunk_id,
            kd.id AS document_id,
            kd.title,
            kc.content,
            kd.source_type,
            GREATEST(
              CASE WHEN q.tsq <> ''::tsquery
                   THEN LEAST(ts_rank_cd(
                        to_tsvector('simple', strip_diacritics(kd.title) || ' ' || kc.content_search), q.tsq) * 6, 1)
                   ELSE 0 END,
              COALESCE((SELECT AVG(word_similarity(lower(tok.t), kc.content_search)) FROM tok), 0) * 0.75,
              COALESCE(
                (SELECT COUNT(*)::float8 / GREATEST(array_length($3::text[], 1), 1)
                 FROM tok
                 WHERE kc.content_search LIKE '%' || lower(tok.t) || '%'),
                0
              ),
              COALESCE((SELECT MAX(similarity(lower(strip_diacritics(kd.title)), lower(tok.t))) FROM tok) * 0.85, 0)
            )::float8 AS score
     FROM knowledge_chunks kc
     JOIN knowledge_documents kd ON kd.id = kc.document_id
     CROSS JOIN q
     WHERE kc.guild_id = $1
       AND (
         kd.visibility = 'public'
         OR kd.allowed_role_ids && $2::text[]
       )
     ORDER BY score DESC
     LIMIT $4`,
    [
      guildId,
      roleIds.length > 0 ? roleIds : ["__no_roles__"],
      tokenArray,
      limit,
      orQuery,
    ],
  );
  return result.rows;
}

async function vectorSearch(
  guildId: string,
  embedding: number[],
  roleIds: string[],
  limit: number,
): Promise<Row[]> {
  const result = await pool.query<Row>(
    `SELECT kc.id AS chunk_id,
            kd.id AS document_id,
            kd.title,
            kc.content,
            kd.source_type,
            (1 - (ke.embedding <=> $2::vector))::float8 AS score
     FROM knowledge_embeddings ke
     JOIN knowledge_chunks kc ON kc.id = ke.chunk_id
     JOIN knowledge_documents kd ON kd.id = kc.document_id
     WHERE kc.guild_id = $1
       AND ke.embedding IS NOT NULL
       AND (
         kd.visibility = 'public'
         OR kd.allowed_role_ids && $3::text[]
       )
     ORDER BY ke.embedding <=> $2::vector
     LIMIT $4`,
    [guildId, `[${embedding.join(",")}]`, roleIds.length > 0 ? roleIds : ["__no_roles__"], limit],
  );
  return result.rows.map((r) => ({ ...r, score: Math.max(0, Number(r.score)) }));
}

export async function searchKnowledge(
  guildId: string,
  query: string,
  options: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const roleIds = options.memberRoleIds ?? [];
  const productLookup = isProductLookupQuery(query);

  const rows = await fulltextSearch(guildId, query, roleIds, limit * 3);

  if (options.queryEmbedding) {
    try {
      const vecRows = await vectorSearch(guildId, options.queryEmbedding, roleIds, limit * 3);
      const byChunk = new Map<string, Row>();
      for (const r of rows) byChunk.set(r.chunk_id, r);
      for (const v of vecRows) {
        const existing = byChunk.get(v.chunk_id);
        if (!existing || v.score > existing.score) {
          byChunk.set(v.chunk_id, { ...v, score: Math.max(existing?.score ?? 0, v.score * 0.95) });
        }
      }
      rows.length = 0;
      rows.push(...byChunk.values());
    } catch {
      // fallback to fulltext-only results
    }
  }

  return rows
    .map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      title: row.title,
      content: row.content,
      sourceType: row.source_type,
      score: productLookup && row.source_type === "product"
        ? Number(row.score) + 0.25
        : Number(row.score),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

