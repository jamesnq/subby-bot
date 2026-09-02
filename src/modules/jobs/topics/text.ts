import { STOPWORDS } from "./constants";

export function sanitizeHistoryContent(content: string): string {
  return content
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/<@!?\d{17,20}>/g, "@[user]")
    .replace(/<@&\d{17,20}>/g, "@[role]")
    .replace(/<#\d{17,20}>/g, "#[channel]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function sanitizeAuthorName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 40) || "member";
}

export function normalizeForRepeat(content: string): string {
  return content.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function extractKeywords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
