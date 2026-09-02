-- Retrieval filters on guild_id in both the vector and the keyword query,
-- but the table only had an index on document_id.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_guild_idx"
  ON "knowledge_chunks" ("guild_id");

-- Without an ANN index every similarity search is a sequential scan over
-- knowledge_embeddings with one distance computation per row. The retrieval
-- query orders by the cosine operator (<=>), so the index must use
-- vector_cosine_ops for the planner to pick it up.
CREATE INDEX IF NOT EXISTS "knowledge_embeddings_hnsw_idx"
  ON "knowledge_embeddings"
  USING hnsw ("embedding" vector_cosine_ops);
