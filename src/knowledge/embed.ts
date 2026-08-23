import { config } from "../config";
import { logger } from "../observability/logger";

export function isEmbeddingEnabled(): boolean {
  return Boolean(config.EMBEDDING_API_KEY);
}

const EMBED_MAX_ATTEMPTS = 3;
const EMBED_BASE_DELAY_MS = 1500;
const EMBED_BATCH_SIZE = 96;
const EMBED_INPUT_MAX_CHARS = 500;

export class EmbeddingUnavailableError extends Error {
  constructor(message = "Embedding provider chưa được cấu hình") {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!isEmbeddingEnabled()) throw new EmbeddingUnavailableError();
  if (texts.length === 0) return [];

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts
      .slice(i, i + EMBED_BATCH_SIZE)
      .map((text) => normalizeEmbeddingInput(text));
    vectors.push(...(await embedBatch(batch)));
  }
  return vectors;
}

function normalizeEmbeddingInput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, EMBED_INPUT_MAX_CHARS);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const url = `${config.EMBEDDING_BASE_URL.replace(/\/$/, "")}/embeddings`;
  const body = JSON.stringify({ model: config.EMBEDDING_MODEL, input: texts });

  let lastError: Error = new EmbeddingUnavailableError();
  for (let attempt = 0; attempt < EMBED_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.EMBEDDING_API_KEY}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const delayMs =
          retryAfter > 0 ? retryAfter * 1000 : EMBED_BASE_DELAY_MS * 2 ** attempt;
        logger.warn(
          { status: res.status, attempt: attempt + 1, delayMs },
          "embedding rate-limited/server error, retrying",
        );
        await sleep(delayMs);
        lastError = new EmbeddingUnavailableError(`Embedding API trả lỗi ${res.status}`);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        logger.error({ status: res.status, body: errBody.slice(0, 300) }, "embedding request failed");
        throw new EmbeddingUnavailableError(`Embedding API trả lỗi ${res.status}`);
      }

      const json = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] };
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const vectors = data.map((d) => d.embedding ?? []);
      if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
        throw new EmbeddingInvalidResponseError();
      }
      return vectors;
    } catch (err) {
      if (err instanceof TypeError) {
        logger.warn({ attempt: attempt + 1 }, "embedding network error, retrying");
        lastError = new EmbeddingUnavailableError("Không kết nối được embedding endpoint");
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export class EmbeddingInvalidResponseError extends Error {
  constructor() {
    super("Phản hồi embedding không hợp lệ");
    this.name = "EmbeddingInvalidResponseError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedQuery(text: string): Promise<number[] | undefined> {
  if (!isEmbeddingEnabled()) return undefined;
  try {
    const [vec] = await embedTexts([text]);
    if (vec && vec.length !== Number(process.env.VECTOR_DIMS ?? "1536")) {
      logger.warn(
        { got: vec.length, expected: process.env.VECTOR_DIMS ?? "1536" },
        "embedding dims mismatch with VECTOR_DIMS - vector search may fail; re-ingest knowledge",
      );
    }
    return vec;
  } catch (err) {
    logger.warn({ err }, "query embedding failed - falling back to fulltext-only retrieval");
    return undefined;
  }
}
