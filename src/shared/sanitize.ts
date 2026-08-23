const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /bỏ qua( tất cả)? hướng dẫn( ở trên)?/gi,
  /system\s*prompt/gi,
  /you\s+are\s+now/gi,
  /\bDISCARD\b\s+\bRULES\b/gi,
  /<\/?(system|assistant|tool)_?msg>/gi,
];

export function sanitizeKnowledgeText(text: string): string {
  let out = text;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, "[filtered]");
  }
  return out.slice(0, 2000);
}

export function stripPublicCitations(text: string): string {
  return text
    .replace(/〖[^〗]*〗/g, "")
    .replace(/\[[^\]]+\.(?:csv|md|txt|pdf|xlsx)[^\]]*\]/gi, "")
    .replace(/[A-Za-z]:\\[^\s]+?\.(?:csv|md|txt|pdf|xlsx)\b/gi, "")
    .replace(/\b[A-Za-z0-9_.-]+\.(?:csv|md|txt|pdf|xlsx)\b/gi, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\[(?:nguồn|source|citation|trích dẫn|tham khảo)[^\]]*\]/gi, "")
    .replace(/^\s*(?:\*\*)?(?:nguồn tham khảo|sources?|trích dẫn|tham khảo)(?:\*\*)?\s*:[\s\S]*$/gim, "")
    .replace(/^\s*[-•]?\s*(?:ID|Slug|Trạng thái|Đã bán|Giảm giá tối đa|ID biến thể|Số biến thể(?: đã lấy)?|Ảnh|Tiêu đề SEO|Mô tả SEO|Nổi bật|Cập nhật lúc|Tạo lúc|Phạm vi hoạt động|sourceScope|operationScope)\s*:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
