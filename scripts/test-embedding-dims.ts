import "dotenv/config";

async function main() {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.EMBEDDING_MODEL,
      input: "Luật server: không spam",
      encodingFormat: "float",
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error("FAILED:", JSON.stringify(json).slice(0, 500));
    process.exit(1);
  }
  console.log("model:", process.env.EMBEDDING_MODEL);
  console.log("dims:", json.data?.[0]?.embedding?.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
