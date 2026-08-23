import "dotenv/config";
import { pool } from "../src/database/pool";

async function main() {
  const ext = await pool.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm')",
  );
  console.log("extensions:", ext.rows.map((r) => r.extname));

  const docs = await pool.query(
    "SELECT guild_id, title, visibility, version FROM knowledge_documents ORDER BY created_at DESC LIMIT 10",
  );
  console.log("documents:", JSON.stringify(docs.rows, null, 2));

  const chunks = await pool.query(
    "SELECT guild_id, count(*) AS chunks FROM knowledge_chunks GROUP BY guild_id",
  );
  console.log("chunks by guild:", chunks.rows);

  const emb = await pool.query(
    "SELECT count(*) FILTER (WHERE embedding IS NOT NULL) AS with_vector, count(*) AS total FROM knowledge_embeddings",
  );
  console.log("embeddings:", emb.rows[0]);

  const guildId = process.argv[2];
  if (guildId) {
    console.log(`--- sample search via searchKnowledge() for guild ${guildId} ---`);
    const { searchKnowledge } = await import("../src/knowledge/retrieve");
    for (const q of ["subgame", "luat server", "huong dan", "nói cho tôi về subgameozone"]) {
      try {
        const results = await searchKnowledge(guildId, q, { limit: 3 });
        console.log(
          `query="${q}"`,
          results.length
            ? results.map((r) => ({
                score: r.score.toFixed(4),
                title: r.title,
                snip: r.content.slice(0, 50),
              }))
            : "(no rows)",
        );
      } catch (err) {
        console.error(`query="${q}" ERROR:`, err instanceof Error ? err.message : err);
      }
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
