import path from "node:path";
import { pool } from "../database/pool";
import { ensurePgVectorExtension } from "../database/pool";
import { ingestDirectory, type IngestVisibility } from "./ingest";

interface CliArgs {
  dir: string;
  guildId: string;
  visibility: IngestVisibility;
  roles: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dir = get("--dir");
  const guildId = get("--guild");
  if (!dir || !guildId) {
    console.error("Usage: npm run ingest -- --dir ./knowledge-data --guild <GUILD_ID> [--visibility public|member|staff] [--roles id1,id2]");
    process.exit(1);
  }
  const visibility = (get("--visibility") ?? "public") as IngestVisibility;
  if (!["public", "member", "staff"].includes(visibility)) {
    console.error(`Invalid visibility: ${visibility}`);
    process.exit(1);
  }
  const roles = (get("--roles") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  return { dir: path.resolve(dir), guildId, visibility, roles };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensurePgVectorExtension();
  const results = await ingestDirectory(args.dir, {
    guildId: args.guildId,
    visibility: args.visibility,
    allowedRoleIds: args.roles,
  });
  for (const r of results) {
    console.log(`✓ ${r.file}: ${r.chunkCount} chunks (v${r.version})`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
