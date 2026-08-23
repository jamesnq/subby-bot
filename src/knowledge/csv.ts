const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: "Tên sản phẩm",
  url: "Link mua",
};

const PUBLIC_PRODUCT_FIELDS = new Set(["name", "url"]);

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  return rows;
}

function cleanCell(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function displayCell(header: string, value: string): string {
  const cleaned = cleanCell(value);
  void header;
  return cleaned;
}

export function csvToKnowledgeText(csv: string): string {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return "";

  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .map((row, index) => {
      const get = (header: string) => row[headers.indexOf(header)] ?? "";
      const status = cleanCell(get("status")).toUpperCase();
      if (status && status !== "PUBLIC") return "";

      const minPrice = cleanCell(get("minPrice"));
      const maxPrice = cleanCell(get("maxPrice"));
      const price = minPrice && maxPrice && minPrice !== maxPrice
        ? `từ ${minPrice}đ đến ${maxPrice}đ`
        : minPrice || maxPrice
          ? `${minPrice || maxPrice}đ`
          : "";

      const values = headers
        .map((header, i) => {
          if (!PUBLIC_PRODUCT_FIELDS.has(header)) return "";
          const value = displayCell(header, row[i] ?? "");
          if (!value) return "";
          const label = PRODUCT_FIELD_LABELS[header] ?? header;
          return `${label}: ${value}`;
        })
        .filter(Boolean);

      if (price) values.splice(1, 0, `Giá: ${price}`);

      if (values.length === 0) return "";
      const name = cleanCell(row[headers.indexOf("name")] ?? "") || `Sản phẩm ${index + 1}`;
      return [`Sản phẩm: ${name}`, ...values].join("\n");
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}
