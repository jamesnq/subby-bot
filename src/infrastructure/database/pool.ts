import { Pool } from "pg";
import { config } from "@config";
import { logger } from "@shared/logger";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

export async function ensurePgVectorExtension(): Promise<boolean> {
  let ok = true;
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  } catch (err) {
    ok = false;
    logger.warn({ err }, "pgvector extension unavailable, vector search disabled");
  }
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  } catch (err) {
    logger.error(
      { err },
      "pg_trgm extension unavailable - knowledge fulltext search (similarity()) will FAIL",
    );
  }
  try {
    await pool.query(`CREATE OR REPLACE FUNCTION strip_diacritics(t text) RETURNS text IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT lower(translate(t,
        'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ',
        'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiioooooooooooooooooooouuuuuuuuuuuyyyydaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiioooooooooooooooooooouuuuuuuuuuuyyyyd'))
    $fn$ LANGUAGE sql`);
  } catch (err) {
    logger.warn({ err }, "strip_diacritics function unavailable");
  }
  return ok;
}
