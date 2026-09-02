import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Derive aliases from tsconfig "paths" so tsx, Vitest, and built Node output
// cannot silently drift apart.
function aliasesFromTsconfig(): Array<{ find: RegExp; replacement: string }> {
  const raw = readFileSync(resolve(projectRoot, "tsconfig.json"), "utf8");
  const { compilerOptions } = JSON.parse(raw) as {
    compilerOptions: { paths: Record<string, string[]> };
  };

  return Object.entries(compilerOptions.paths).map(([pattern, [target]]) => {
    const isWildcard = pattern.endsWith("/*");
    const prefix = isWildcard ? pattern.slice(0, -2) : pattern;
    return {
      find: isWildcard ? new RegExp(`^${prefix}/(.*)$`) : new RegExp(`^${prefix}$`),
      replacement: isWildcard
        ? resolve(projectRoot, target.slice(0, -2)) + "/$1"
        : resolve(projectRoot, target),
    };
  });
}

export default defineConfig({
  resolve: { alias: aliasesFromTsconfig() },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
