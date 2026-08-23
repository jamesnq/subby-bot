import { describe, expect, it } from "vitest";
import { maxRisk, getAllTools } from "../src/tools/registry";
import "../src/tools";

describe("registry helpers", () => {
  it("maxRisk: empty array is read", () => {
    expect(maxRisk([])).toBe("read");
  });

  it("maxRisk precedence destructive > write > read", () => {
    expect(maxRisk(["read", "write"])).toBe("write");
    expect(maxRisk(["write", "destructive", "read"])).toBe("destructive");
    expect(maxRisk(["read", "read"])).toBe("read");
  });

  it("all catalog tools registered with unique names", () => {
    const tools = getAllTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(18);
  });

  it("planning spec strips $schema and tags risk in description", async () => {
    const { getPlanningSpecs } = await import("../src/tools/registry");
    const specs = getPlanningSpecs(["delete_channel"]);
    expect(specs).toHaveLength(1);
    expect(specs[0].function.parameters).not.toHaveProperty("$schema");
    expect(specs[0].function.description).toContain("[risk:destructive]");
  });
});
