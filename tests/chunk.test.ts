import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "../src/modules/knowledge/chunk";

describe("splitIntoChunks", () => {
  it("returns empty for empty input", () => {
    expect(splitIntoChunks("")).toEqual([]);
    expect(splitIntoChunks("   \n  \n ")).toEqual([]);
  });

  it("keeps a short text as one chunk", () => {
    const chunks = splitIntoChunks("# FAQ\n\nCâu hỏi thường gặp về server.");
    expect(chunks).toHaveLength(1);
  });

  it("splits by paragraphs when exceeding max size", () => {
    const para = "x".repeat(300);
    const text = [para, para, para].join("\n\n");
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(800);
    }
  });

  it("hard-splits a single oversized paragraph", () => {
    const text = "y".repeat(2000);
    const chunks = splitIntoChunks(text);
    expect(chunks.every((c) => c.length <= 800)).toBe(true);
    expect(chunks.join("").length).toBe(2000);
  });

  it("normalizes CRLF and separates oversized paragraphs", () => {
    const para1 = "a".repeat(500);
    const para2 = "b".repeat(500);
    const chunks = splitIntoChunks(para1 + "\r\n\r\n" + para2);
    expect(chunks).toEqual([para1, para2]);
  });

  it("merges small adjacent paragraphs into one chunk", () => {
    const chunks = splitIntoChunks("a\n\nb");
    expect(chunks).toEqual(["a\n\nb"]);
  });

  it("treats horizontal separators as hard chunk boundaries", () => {
    const chunks = splitIntoChunks("product one\n\n---\n\nproduct two");
    expect(chunks).toEqual(["product one", "product two"]);
  });
});
