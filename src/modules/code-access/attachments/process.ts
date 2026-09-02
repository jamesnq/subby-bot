import crypto from "node:crypto";
import sharp from "sharp";
import { buildUserAttachmentKey, putUserAttachment } from "@infra/storage/s3";
import type { EvidenceKind, PreparedEvidence, RemoteImage, UploadableEvidence } from "./types";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export async function processAndStoreEvidence(input: {
  guildId: string;
  userId: string;
  kind: EvidenceKind;
  image: RemoteImage;
  now?: Date;
  fetchImage?: typeof fetch;
  upload?: typeof putUserAttachment;
}): Promise<PreparedEvidence> {
  const prepared = await prepareEvidence(input);
  await uploadPreparedEvidence(prepared, input.upload);
  const { body: _body, ...result } = prepared;
  return result;
}

export async function prepareEvidence(input: {
  guildId: string;
  userId: string;
  kind: EvidenceKind;
  image: RemoteImage;
  now?: Date;
  fetchImage?: typeof fetch;
}): Promise<UploadableEvidence> {
  if (input.image.size && input.image.size > MAX_SOURCE_BYTES) throw new Error("Ảnh vượt quá 5MB");
  if (input.image.contentType && !input.image.contentType.startsWith("image/")) throw new Error("File không phải ảnh");

  const bytes = await downloadImage(input.image.url, input.fetchImage ?? fetch);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const converted = await sharp(bytes)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const s3Key = buildUserAttachmentKey({
    guildId: input.guildId,
    userId: input.userId,
    kind: input.kind,
    sha256,
    now: input.now,
  });
  return {
    sha256,
    s3Key,
    dataUrl: `data:image/jpeg;base64,${converted.data.toString("base64")}`,
    width: converted.info.width,
    height: converted.info.height,
    body: converted.data,
  };
}

export async function uploadPreparedEvidence(evidence: UploadableEvidence, upload: typeof putUserAttachment = putUserAttachment): Promise<void> {
  await upload({ key: evidence.s3Key, body: evidence.body, contentType: "image/jpeg" });
}

async function downloadImage(url: string, fetchImage: typeof fetch): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Attachment URL must use HTTPS");
  const response = await fetchImage(parsed, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Không tải được ảnh (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_SOURCE_BYTES) throw new Error("Ảnh vượt quá 5MB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) throw new Error("Ảnh rỗng hoặc vượt quá 5MB");
  return bytes;
}
