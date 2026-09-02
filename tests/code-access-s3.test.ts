import { describe, expect, it } from "vitest";
import { buildUserAttachmentKey, isPrivateUserAttachmentKey } from "../src/infrastructure/storage/s3";
import { config } from "../src/config";

describe("code access S3", () => {
  it("builds content-addressed private keys", () => {
    const key = buildUserAttachmentKey({ guildId: "g1", userId: "u1", kind: "device", sha256: "a".repeat(64), now: new Date("2026-09-02T00:00:00Z") });
    expect(key).toBe("user_att/g1/u1/2026/09/device-aaaaaaaaaaaaaaaa.jpg");
    expect(isPrivateUserAttachmentKey(key)).toBe(true);
    expect(key).not.toContain(config.S3_ENDPOINT);
  });
  it("rejects traversal and clamps the configured presign default", () => {
    expect(isPrivateUserAttachmentKey("user_att/../secret")).toBe(false);
    expect(config.S3_PRESIGN_TTL_SECONDS).toBe(900);
  });
});
