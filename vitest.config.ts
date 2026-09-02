import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Derive aliases from tsconfig "paths" so the three execution modes
// (tsx, vitest, node dist/) never drift apart.
function aliasesFromTsconfig(): Array<{ find: RegExp; replacement: string }> {
  const raw = readFileSync(resolve(__dirname, "tsconfig.json"), "utf8");
  const { compilerOptions } = JSON.parse(raw) as {
    compilerOptions: { paths: Record<string, string[]> };
  };

  return Object.entries(compilerOptions.paths).map(([pattern, [target]]) => {
    const isWildcard = pattern.endsWith("/*");
    const prefix = isWildcard ? pattern.slice(0, -2) : pattern;
    return {
      find: isWildcard ? new RegExp(`^${prefix}/(.*)$`) : new RegExp(`^${prefix}$`),
      replacement: isWildcard
        ? resolve(__dirname, target.slice(0, -2)) + "/$1"
        : resolve(__dirname, target),
    };
  });
}

export default defineConfig({
  resolve: {
    alias: aliasesFromTsconfig(),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
