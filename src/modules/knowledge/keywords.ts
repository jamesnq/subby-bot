const STOPWORDS = new Set([
  "cho",
  "toi",
  "ve",
  "cua",
  "la",
  "gi",
  "va",
  "voi",
  "nao",
  "ban",
  "minh",
  "nhu",
  "the",
  "what",
  "how",
  "is",
  "are",
  "about",
  "tell",
  "and",
  "for",
  "co",
  "khong",
  "mot",
  "nhung",
  "bao",
  "nhieu",
  "san",
  "pham",
  "this",
  "that",
]);

export function stripDiacritics(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

export type ExtractedKeywords = {
  tokens: string[];
  orQuery: string;
};

export function extractKeywords(query: string): ExtractedKeywords {
  const folded = stripDiacritics(query).trim();
  if (!folded) return { tokens: [], orQuery: "" };

  const rawTokens = folded
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .slice(0, 8);

  if (rawTokens.length === 0) {
    const fallback = folded.split(/\s+/).filter(Boolean).slice(0, 3);
    return { tokens: fallback, orQuery: fallback.join(" or ") };
  }

  const unique = [...new Set(rawTokens)];
  return { tokens: unique, orQuery: unique.join(" or ") };
}
