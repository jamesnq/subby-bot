import { describe, expect, it } from "vitest";
import { csvToKnowledgeText } from "../src/knowledge/csv";

describe("csvToKnowledgeText", () => {
  it("turns product rows into searchable knowledge blocks", () => {
    const csv = [
      "id,name,minPrice,maxPrice,categories,descriptionText,apiSource,sourceScope",
      '297,"Beast of Reincarnation","59,000","59,000","Tài khoản Steam Offline, Key Steam","Dòng một',
      'Dòng hai",internal-api,private',
    ].join("\n");

    const text = csvToKnowledgeText(csv);

    expect(text).toContain("Sản phẩm: Beast of Reincarnation");
    expect(text).toContain("Giá: 59,000đ");
    expect(text).not.toContain("Danh mục");
    expect(text).not.toContain("Mô tả");
    expect(text).not.toContain("Nguồn API");
    expect(text).not.toContain("Phạm vi nguồn");
  });

  it("hides internal ecommerce fields and stopped products", () => {
    const csv = [
      "id,name,slug,status,url,sold,minPrice,maxPrice,variantIdsFromProduct,variantCountFromProduct,variantCountFetched,sourceScope,operationScope",
      '297,"Brawlhalla","brawlhalla-steam","PUBLIC","https://subgamezone.com/products/brawlhalla","123","19,000","29,000","v1|v2","2","2","Brawazoski","Phạm vi hoạt động"',
      '298,"Old Product","old-product","STOPPED","https://example.test/old","1","9,000","9,000","v3","1","1","internal","hidden"',
    ].join("\n");

    const text = csvToKnowledgeText(csv);

    expect(text).toContain("Sản phẩm: Brawlhalla");
    expect(text).toContain("Giá: từ 19,000đ đến 29,000đ");
    expect(text).toContain("Link mua: https://subgamezone.com/products/brawlhalla");
    expect(text).not.toMatch(/\bID\b|Slug|Trạng thái|Đã bán|biến thể/i);
    expect(text).not.toContain("Brawazoski");
    expect(text).not.toContain("Phạm vi hoạt động");
    expect(text).not.toContain("Old Product");
  });
});
