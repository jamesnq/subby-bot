import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const optionalPortSchema = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(65_535).optional(),
);

const timeOfDaySchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  "must be a valid HH:MM time from 00:00 to 23:59",
);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  ADMIN_DISCORD_ID: z
    .string()
    .regex(/^\d{17,20}$/, "ADMIN_DISCORD_ID must be a Discord user ID"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().default("stealth/ox-alpha"),
  LLM_SMALL_MODEL: z.string().default("stealth/ox-alpha"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(60_000),
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid postgres connection URL"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  HEALTH_PORT: optionalPortSchema,
  INSTANCE_LOCK_PORT: optionalPortSchema,
  APPROVAL_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_TOOL_CALLS_PER_REQUEST: z.coerce.number().int().min(1).max(10).default(10),
  MAX_RESOURCES_PER_PLAN: z.coerce.number().int().min(1).max(25).default(5),
  RATE_LIMIT_USER_PER_MINUTE: z.coerce.number().int().positive().default(10),
  CONVERSATION_SESSION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CONVERSATION_SESSION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  CONVERSATION_SESSION_FOLLOWUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  KNOWLEDGE_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.15),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  VECTOR_DIMS: z.coerce.number().int().min(64).max(4096).default(1536),
  KNOWLEDGE_CACHE_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  GUILD_DAILY_LLM_CALLS_LIMIT: z.coerce.number().int().min(1).default(500),
  GUILD_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(1000).default(300_000),
  PROACTIVE_TOPIC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  PROACTIVE_TOPIC_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(120),
  PROACTIVE_TOPIC_MAX_PER_GUILD_DAY: z.coerce.number().int().min(1).default(3),
  PROACTIVE_TOPIC_QUIET_START: timeOfDaySchema.default("23:00"),
  PROACTIVE_TOPIC_QUIET_END: timeOfDaySchema.default("07:00"),
  PROACTIVE_TOPIC_IDLE_MINUTES: z.coerce.number().int().min(5).default(45),
  PROACTIVE_TOPIC_HISTORY_LIMIT: z.coerce.number().int().min(3).max(50).default(20),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  console.error(`Invalid environment configuration -> ${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;

