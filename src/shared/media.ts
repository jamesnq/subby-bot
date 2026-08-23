export type SimpleAttachment = {
  url: string;
  name: string;
  contentType?: string | null;
  size?: number;
};

export const MAX_IMAGES_PER_REQUEST = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function isImageAttachment(att: SimpleAttachment): boolean {
  return Boolean(att.contentType && att.contentType.startsWith("image/"));
}

export function isVideoAttachment(att: SimpleAttachment): boolean {
  return Boolean(att.contentType && att.contentType.startsWith("video/"));
}

export function collectImageAttachments(attachments: SimpleAttachment[]): {
  images: SimpleAttachment[];
  skippedCount: number;
} {
  const candidates = attachments.filter(
    (a) => isImageAttachment(a) && (a.size ?? 0) <= MAX_IMAGE_BYTES,
  );
  return {
    images: candidates.slice(0, MAX_IMAGES_PER_REQUEST),
    skippedCount: Math.max(0, candidates.length - MAX_IMAGES_PER_REQUEST),
  };
}

export function describeAttachments(attachments: SimpleAttachment[]): string {
  const lines: string[] = [];
  for (const att of attachments) {
    if (isImageAttachment(att)) continue;
    if (isVideoAttachment(att)) {
      lines.push(`- video "${att.name}" (${formatBytes(att.size ?? 0)})`);
    } else {
      lines.push(`- tệp "${att.name}" (${att.contentType ?? "không rõ loại"})`);
    }
  }
  return lines.join("\n");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildMultimodalContent(text: string, imageUrls: string[]): ContentPart[] {
  const parts: ContentPart[] = [{ type: "text", text }];
  for (const url of imageUrls) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}
