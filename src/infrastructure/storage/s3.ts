import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@config";

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!config.S3_ENABLED) throw new Error("S3 storage is disabled");
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 credentials are incomplete");
  }
  client ??= new S3Client({
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: true,
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export async function putUserAttachment(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  assertPrivateUserKey(input.key);
  await getClient().send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: "private, max-age=0, no-store",
  }));
}

export async function presignUserAttachment(
  key: string,
  ttlSeconds = config.S3_PRESIGN_TTL_SECONDS,
): Promise<string> {
  assertPrivateUserKey(key);
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    { expiresIn: Math.min(Math.max(ttlSeconds, 60), 3_600) },
  );
}

export async function deleteUserAttachment(key: string): Promise<void> {
  assertPrivateUserKey(key);
  await getClient().send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export function buildUserAttachmentKey(input: {
  guildId: string;
  userId: string;
  kind: "order" | "device" | "steam";
  sha256: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const prefix = normalizedPrefix();
  const guildId = safeSegment(input.guildId);
  const userId = safeSegment(input.userId);
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("Invalid attachment sha256");
  return `${prefix}${guildId}/${userId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${input.kind}-${input.sha256.slice(0, 16).toLowerCase()}.jpg`;
}

export function isPrivateUserAttachmentKey(key: string): boolean {
  return key.startsWith(normalizedPrefix()) && !key.includes("..") && !key.includes("//");
}

function assertPrivateUserKey(key: string): void {
  if (!isPrivateUserAttachmentKey(key)) throw new Error("S3 key is outside the private user attachment prefix");
}

function normalizedPrefix(): string {
  const prefix = config.S3_PREFIX.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${prefix || "user_att"}/`;
}

function safeSegment(value: string): string {
  const result = value.replace(/[^A-Za-z0-9_-]/g, "");
  if (!result) throw new Error("Invalid attachment key segment");
  return result;
}
