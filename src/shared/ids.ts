import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export function newRequestId(): string {
  return randomUUID();
}

// Chuẩn hoá đệ quy: sắp xếp key để hash không phụ thuộc thứ tự key.
// Bắt buộc vì plan_json lưu trong cột Postgres JSONB vốn sắp xếp lại key.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function planHash(steps: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(steps)))
    .digest("hex");
}
