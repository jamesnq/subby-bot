import { describe, expect, it } from "vitest";
import { isAdminUser } from "../src/discord/permissions/guard";

describe("admin gate", () => {
  it("isAdminUser matches the configured ADMIN_DISCORD_ID only", () => {
    const adminId = process.env.ADMIN_DISCORD_ID ?? "852584177382981643";
    expect(isAdminUser(adminId)).toBe(true);
    expect(isAdminUser("123456789012345678")).toBe(false);
  });
});
