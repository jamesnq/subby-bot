import { describe, expect, it, vi } from "vitest";
import { codeCommand } from "../src/modules/discord/commands/code";

describe("codeCommand definition", () => {
  it("defines the /code slash command", () => {
    const json = codeCommand.toJSON();
    expect(json.name).toBe("code_reseller");
    expect(json.contexts).toEqual([0, 1]);
    expect(json.description).toContain("Steam Guard");
    expect(json.options).toBeDefined();
    expect(json.options?.length).toBeGreaterThanOrEqual(1);

    const accountOption = json.options?.find((o: any) => o.name === "account");
    expect(accountOption).toBeDefined();
    expect(accountOption?.required).toBe(true);
  });
});
