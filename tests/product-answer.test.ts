import { describe, expect, it } from "vitest";
import { answerProductPriceQuery, parseProductSummary } from "../src/modules/knowledge/product-answer";
import type { RetrievedChunk } from "../src/modules/knowledge/retrieve";

function chunk(content: string): RetrievedChunk {
  return {
    chunkId: "chunk",
    documentId: "doc",
    title: "Products",
    content,
    sourceType: "product",
    score: 1,
  };
}

describe("product answer formatting", () => {
  it("extracts only customer-facing product fields", () => {
    const product = parseProductSummary(
      [
        "Sản phẩm: Gói Nạp Brawlhalla",
        "Giá: từ 10,000đ đến 600,000đ",
        "Link mua: https://subgamezone.com/products/goi-nap-brawlhalla",
        "ID: 1",
        "Slug: goi-nap-brawlhalla",
      ].join("\n"),
    );

    expect(product).toEqual({
      name: "Gói Nạp Brawlhalla",
      price: "từ 10,000đ đến 600,000đ",
      url: "https://subgamezone.com/products/goi-nap-brawlhalla",
    });
  });

  it("answers price queries without dumping CSV metadata", () => {
    const answer = answerProductPriceQuery("giá nạp coin brawlhalla", [
      chunk(
        [
          "Sản phẩm: Gói Nạp Brawlhalla",
          "Giá: từ 10,000đ đến 600,000đ",
          "Link mua: https://subgamezone.com/products/goi-nap-brawlhalla",
          "ID: 1",
          "Slug: goi-nap-brawlhalla",
          "Trạng thái: PUBLIC",
          "Đã bán: 1,180",
          "ID biến thể: 1, 2, 3",
          "Phạm vi hoạt động: Brawazoski",
        ].join("\n"),
      ),
    ]);

    expect(answer).toContain("Gói Nạp Brawlhalla");
    expect(answer).toContain("từ 10,000đ đến 600,000đ");
    expect(answer).toContain("https://subgamezone.com/products/goi-nap-brawlhalla");
    expect(answer).not.toMatch(/\bID\b|Slug|Trạng thái|Đã bán|biến thể|Phạm vi hoạt động|Brawazoski/i);
  });

  it("prioritizes topically specific product cards for coin top-up questions", () => {
    const answer = answerProductPriceQuery("giá nạp coin brawlhalla", [
      chunk(
        [
          "Sản phẩm: Brawlhalla Codes",
          "Giá: 1,199,000đ",
          "Link mua: https://subgamezone.com/products/brawlhalla-codes",
        ].join("\n"),
      ),
      chunk(
        [
          "Sản phẩm: Gói Nạp Brawlhalla",
          "Giá: từ 10,000đ đến 600,000đ",
          "Link mua: https://subgamezone.com/products/goi-nap-brawlhalla",
        ].join("\n"),
      ),
    ]);

    expect(answer).toContain("Gói Nạp Brawlhalla");
    expect(answer).toContain("từ 10,000đ đến 600,000đ");
    expect(answer).not.toContain("Brawlhalla Codes");
  });
});
