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
  CODE_PAYMENT_ENABLED: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  PAYOS_CLIENT_KEY: z.string().optional(),
  PAYOS_API_KEY: z.string().optional(),
  PAYOS_CHECKSUM_KEY: z.string().optional(),
  PAYOS_RETURN_URL: z.string().url().default("https://discord.com/channels/@me"),
  PAYOS_CANCEL_URL: z.string().url().default("https://discord.com/channels/@me"),
  CODE_PAYMENT_MAX_CODE_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(15),

  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  ADMIN_DISCORD_ID: z
    .string()
    .regex(/^\d{17,20}$/, "ADMIN_DISCORD_ID must be a Discord user ID")
    .optional(),
  OPENROUTER_API_KEY: z.string().optional(),
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
  STATE_BACKEND: z.enum(["memory", "postgres"]).default("memory"),
  /**
   * Master switch for the /ai assistant (slash command, @mention trigger,
   * /ai-config). Independent of guild_settings.enabled — that's a per-guild
   * admin toggle for an already-deployed bot; this is the deploy-time gate
   * for shipping /code to production before the AI assistant is ready to go
   * live. Defaults true so nothing changes unless a deploy explicitly opts out.
   */
  AI_ASSISTANT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CONVERSATION_SESSION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CONVERSATION_SESSION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  CONVERSATION_SESSION_FOLLOWUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CODE_ACCESS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CODE_ACCESS_USER_DAILY_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
  CODE_ACCESS_GUILD_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),
  CODE_ACCESS_ALLOWED_ACCOUNTS: z.string().default("XardGames1,XardGames2,XardGames3,XardGames4,XardGames5"),
  CODE_ACCESS_ISSUE_CODES: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  CODE_ACCESS_REQUEST_DAILY_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  CODE_ACCESS_SCREENSHOT_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(180).default(30),
  CODE_ACCESS_OS_POLICY: z.enum(["warn", "suspend"]).default("warn"),
  CODE_ACCESS_ESCALATE_BELOW: z.coerce.number().min(0).max(1).default(0.8),
  CODE_ACCESS_AUTO_APPROVE_ABOVE: z.coerce.number().min(0).max(1).default(0.9),
  SUPPORT_FANPAGE_URL: z.string().url().default("https://www.facebook.com/subgamezoneoffical"),
  CODE_ACCESS_THREAD_TTL_MINUTES: z.coerce.number().int().min(1).max(180).default(15),
  CODE_ACCESS_TRANSCRIPT_CHANNEL_ID: z.string().regex(/^\d{17,20}$/).default("1544663692254384189"),
  S3_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  S3_ENDPOINT: z.string().url().default("https://s3.subgamezone.com"),
  S3_BUCKET: z.string().default("subby"),
  S3_REGION: z.string().default("ap-southeast-1"),
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_PREFIX: z.string().default("user_att/"),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  OCR_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  OCR_BASE_URL: z.string().url().default("https://cheapkeyai.shop/v1"),
  OCR_MODEL: z.string().default("gemini-2.5-flash-lite"),
  OCR_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OCR_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
  OCR_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(2_000).default(700),
  GMAIL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GMAIL_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GMAIL_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  GMAIL_REFRESH_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  GMAIL_USER_ID: z.string().default("me"),
  GMAIL_STEAM_FROM: z.string().email().default("noreply@steampowered.com"),
  GMAIL_STEAM_QUERY_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /**
   * How long a cached Steam Guard code may still be served when Gmail is
   * unreachable, and how long a row survives before the sweeper deletes it.
   * These are live one-time codes - the cache is a short outage buffer, not
   * a record store.
   */
  STEAM_CODE_CACHE_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  GMAIL_REDACT_SENSITIVE: z
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
}).superRefine((value, ctx) => {
  if (value.CODE_PAYMENT_ENABLED) {
    for (const key of ["PAYOS_CLIENT_KEY", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY"] as const) {
      if (!value[key]) ctx.addIssue({code:z.ZodIssueCode.custom,path:[key],message:"is required when CODE_PAYMENT_ENABLED=true"});
    }
  }

  if (value.CODE_ACCESS_ESCALATE_BELOW > value.CODE_ACCESS_AUTO_APPROVE_ABOVE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CODE_ACCESS_ESCALATE_BELOW"],
      message: "must be less than or equal to CODE_ACCESS_AUTO_APPROVE_ABOVE",
    });
  }
  if (value.S3_ENABLED && (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["S3_ACCESS_KEY_ID"], message: "S3 credentials are required when S3_ENABLED=true" });
  }
  if (value.OCR_ENABLED && !value.OCR_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OCR_API_KEY"], message: "is required when OCR_ENABLED=true" });
  }
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
