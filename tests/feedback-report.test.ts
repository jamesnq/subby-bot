import { describe, expect, it } from "vitest";
import { improvementSuggestion, renderFeedbackReport } from "../src/modules/feedback/service";

describe("feedback improvement reports", () => {
  it("sanitizes admin feedback report text", () => {
    const report = renderFeedbackReport([
      {
        requestId: "req-1",
        userId: "123456789012345678",
        createdAt: new Date("2026-08-23T05:00:00Z"),
        question: "giá brawlhalla trong Products.csv",
        answer: [
          "Brawlhalla có giá 19,000đ 〖12†source〗",
          "ID: 297",
          "Slug: brawlhalla-steam",
          "Phạm vi hoạt động: Brawazoski",
          "token: sk-secretvalue",
          "Nguồn tham khảo:",
          "Products.csv",
        ].join("\n"),
        suggestion: "Kiểm tra knowledge.",
      },
    ]);

    expect(report).toContain("req-1");
    expect(report).toContain("giá brawlhalla");
    expect(report).toContain("19,000đ");
    expect(report).not.toMatch(/source|nguồn|Products\.csv|〖|\bID\b|Slug|Phạm vi hoạt động|Brawazoski|sk-secretvalue/i);
  });

  it("suggests review actions without mutating product knowledge", () => {
    const suggestion = improvementSuggestion({
      intent: "knowledge",
      answer: "Gói Nạp Brawlhalla giá từ 10,000đ đến 600,000đ",
      retrievedChunks: [
        {
          chunkId: "c1",
          documentId: "d1",
          title: "Products",
          sourceType: "product",
          score: 1,
        },
      ],
    });

    expect(suggestion).toMatch(/CSV|knowledge|alias|từ khóa/i);
    expect(suggestion).not.toMatch(/tự sửa|overwrite|ghi thẳng/i);
  });
});
