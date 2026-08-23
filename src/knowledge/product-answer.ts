import { stripDiacritics } from "./keywords";
import type { RetrievedChunk } from "./retrieve";

type ProductSummary = {
  name: string;
  price?: string;
  url?: string;
};

type RankedProduct = ProductSummary & {
  matchScore: number;
  retrievalScore: number;
};

const PRICE_QUERY_TERMS = [
  "gia",
  "bao nhieu",
  "mua",
  "link",
  "nap",
  "coin",
  "code",
  "codes",
  "goi",
  "shop",
];

function valueAfterLabel(content: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escaped}:\\s*(.+)$`, "im").exec(content);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

function formatPrice(content: string): string | undefined {
  const explicit = valueAfterLabel(content, ["Giá"]);
  if (explicit) return explicit;

  const minPrice = valueAfterLabel(content, ["Giá thấp nhất"]);
  const maxPrice = valueAfterLabel(content, ["Giá cao nhất"]);
  if (!minPrice && !maxPrice) return undefined;
  if (minPrice && maxPrice && minPrice !== maxPrice) return `từ ${minPrice}đ đến ${maxPrice}đ`;
  return `${minPrice ?? maxPrice}đ`;
}

export function parseProductSummary(content: string): ProductSummary | undefined {
  const name = valueAfterLabel(content, ["Sản phẩm", "Tên sản phẩm"]);
  if (!name) return undefined;

  const url = valueAfterLabel(content, ["Link mua", "URL"]);
  return {
    name,
    price: formatPrice(content),
    url,
  };
}

function isProductPriceQuery(input: string): boolean {
  const normalized = stripDiacritics(input);
  return PRICE_QUERY_TERMS.some((term) => normalized.includes(term));
}

function queryTokens(input: string): string[] {
  return stripDiacritics(input)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !["gia", "bao", "nhieu", "shop"].includes(token));
}

function productMatchScore(input: string, content: string): number {
  const normalizedContent = stripDiacritics(content);
  const tokens = queryTokens(input);
  let score = tokens.filter((token) => normalizedContent.includes(token)).length;

  const normalizedInput = stripDiacritics(input);
  if (normalizedInput.includes("coin") && normalizedContent.includes("nap")) score += 1;
  if (normalizedInput.includes("nap") && normalizedContent.includes("goi nap")) score += 1;
  return score;
}

function formatProductLine(product: ProductSummary): string {
  const price = product.price ? `\nGiá hiện tại: **${product.price}**` : "";
  const url = product.url ? `\nMua tại: ${product.url}` : "";
  return `**${product.name}**${price}${url}`;
}

export function answerProductPriceQuery(
  input: string,
  chunks: RetrievedChunk[],
): string | undefined {
  if (!isProductPriceQuery(input)) return undefined;

  const products: RankedProduct[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const product = parseProductSummary(chunk.content);
    if (!product) continue;

    const key = `${product.name}|${product.url ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      ...product,
      matchScore: productMatchScore(input, chunk.content),
      retrievalScore: chunk.score,
    });
  }

  if (products.length === 0) return undefined;
  products.sort((a, b) =>
    b.matchScore - a.matchScore || b.retrievalScore - a.retrievalScore || a.name.localeCompare(b.name),
  );

  const topMatchScore = products[0].matchScore;
  const visibleProducts = products.filter((product) => product.matchScore === topMatchScore);

  if (visibleProducts.length === 1) {
    return [
      "Dạ, mình tìm thấy sản phẩm này bên shop:",
      "",
      formatProductLine(visibleProducts[0]),
      "",
      "Bạn bấm link để xem đúng gói/mệnh giá còn hàng nhé.",
    ].join("\n");
  }

  return [
    "Dạ, mình tìm thấy vài sản phẩm phù hợp:",
    "",
    ...visibleProducts.slice(0, 3).map((product) => `- ${formatProductLine(product)}`),
    "",
    "Bạn bấm link sản phẩm phù hợp để xem đúng gói/mệnh giá còn hàng nhé.",
  ].join("\n");
}
