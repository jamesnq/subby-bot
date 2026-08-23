const MAX_CHUNK_CHARS = 800;

export function splitIntoChunks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed === "---") {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      continue;
    }

    if (trimmed.length > MAX_CHUNK_CHARS) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < trimmed.length; i += MAX_CHUNK_CHARS) {
        chunks.push(trimmed.slice(i, i + MAX_CHUNK_CHARS).trim());
      }
      continue;
    }

    if ((current + "\n\n" + trimmed).length > MAX_CHUNK_CHARS && current) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = current ? `${current}\n\n${trimmed}` : trimmed;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
