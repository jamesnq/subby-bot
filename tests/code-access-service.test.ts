import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeAccessVerificationResult } from "../src/modules/code-access/verification";

const { dbMock, selectChain, insertChain, updateChain, writeAuditMock } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };

  const insertChain = {
    valuesArg: undefined as unknown,
    values: vi.fn((values: unknown) => {
      insertChain.valuesArg = values;
      return insertChain;
    }),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => [insertChain.valuesArg]),
  };

  const updateChain = {
    setArg: undefined as unknown,
    set: vi.fn((values: unknown) => {
      updateChain.setArg = values;
      return updateChain;
    }),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => [{ id: "ent-1", ...(updateChain.setArg as Record<string, unknown>) }]),
  };

  return {
    selectChain,
    insertChain,
    updateChain,
    writeAuditMock: vi.fn().mockResolvedValue(undefined),
    dbMock: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("../src/modules/database/db", () => ({ db: dbMock }));
vi.mock("../src/modules/database/audit", () => ({ writeAudit: writeAuditMock }));

import {
  adminReviewEntitlement,
  fingerprintDevice,
  getEntitlement,
  normalizeSteamUsername,
  requestAccessDecision,
  upsertVerificationSubmission,
} from "../src/modules/code-access/service";

function verification(overrides: Partial<CodeAccessVerificationResult> = {}): CodeAccessVerificationResult {
  const base: CodeAccessVerificationResult = {
    fullScreenVisible: true,
    dateTimeVisible: true,
    purchaseLooksValid: true,
    durationMonths: 1,
    purchaseDate: "2026-08-01",
    expiresAt: "2026-09-01",
    deviceFingerprint: {
      deviceName: "Pixel 9",
      platform: "Android",
      model: "Pixel 9 Pro",
      osVersion: "Android 16",
      serialNumber: "SN123",
      imei: null,
      meid: null,
      androidId: "android-1",
      udid: null,
      hardwareId: null,
      rawVisibleIdentifiers: ["Serial: SN123"],
    },
    deviceFingerprintLabel: "Pixel 9",
    deviceFingerprintParts: ["Pixel 9", "SN123", "android-1"],
    confidence: 0.92,
    reasons: ["Looks valid."],
  };
  return { ...base, ...overrides };
}

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    id: "ent-1",
    guildId: "g1",
    userId: "u1",
    steamUsername: "xardgames1",
    status: "approved",
    subscriptionStart: new Date("2026-08-01T00:00:00.000Z"),
    subscriptionEnd: new Date("2026-09-01T00:00:00.000Z"),
    deviceFingerprintHash: null,
    deviceFingerprintLabel: null,
    purchaseProofUrl: "https://cdn.example.test/proof.png",
    deviceInfoUrl: "https://cdn.example.test/device.png",
    verificationJson: {},
    reviewedBy: "admin1",
    reviewedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("code access service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertChain.valuesArg = undefined;
    updateChain.setArg = undefined;
    selectChain.limit.mockResolvedValue([]);
  });

  it("normalizes Steam usernames and profile URLs", () => {
    expect(normalizeSteamUsername("  @Steam_User.1  ")).toBe("steam_user.1");
    expect(normalizeSteamUsername("https://steamcommunity.com/id/SomeUser/?utm_source=x")).toBe("someuser");
    expect(normalizeSteamUsername("https://steamcommunity.com/profiles/76561198000000000/")).toBe("76561198000000000");
  });

  it("finds entitlements using the normalized Steam username", async () => {
    selectChain.limit.mockResolvedValueOnce([entitlement()]);

    const row = await getEntitlement({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "https://steamcommunity.com/id/XardGames1/",
    });

    expect(row?.steamUsername).toBe("xardgames1");
    expect(selectChain.limit).toHaveBeenCalledWith(1);
  });

  it("allows only approved, unexpired manual code access", async () => {
    selectChain.limit.mockResolvedValueOnce([entitlement()]);

    const decision = await requestAccessDecision({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      now: new Date("2026-08-23T00:00:00.000Z"),
    });

    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.message).toContain("bot không tự động phát mã đăng nhập");
  });

  it("denies Gmail, 2FA, and automatic code retrieval before querying entitlements", async () => {
    for (const requestedCapability of ["gmail_access", "two_factor_code", "code_retrieval"] as const) {
      const decision = await requestAccessDecision({
        guildId: "g1",
        discordUserId: "u1",
        steamUsername: "XardGames1",
        requestedCapability,
      });

      expect(decision.ok).toBe(false);
      if (decision.ok) throw new Error("Expected unsupported capability to be denied");
      expect(decision.reason).toMatch(/does not retrieve/i);
    }
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("denies expired or pending entitlements", async () => {
    selectChain.limit
      .mockResolvedValueOnce([entitlement({ subscriptionEnd: new Date("2026-08-01T00:00:00.000Z") })])
      .mockResolvedValueOnce([entitlement({ status: "pending" })]);

    const expired = await requestAccessDecision({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      now: new Date("2026-08-23T00:00:00.000Z"),
    });
    const pending = await requestAccessDecision({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      now: new Date("2026-08-23T00:00:00.000Z"),
    });

    expect(expired.ok).toBe(false);
    if (expired.ok) throw new Error("Expected expired entitlement to be denied");
    expect(expired.reason).toContain("hết hạn");
    expect(pending.ok).toBe(false);
    if (pending.ok) throw new Error("Expected pending entitlement to be denied");
    expect(pending.reason).toContain("pending");
  });

  it("upserts verification submissions without retrieving codes", async () => {
    const result = await upsertVerificationSubmission({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      purchaseProofUrl: "https://cdn.example.test/proof.png",
      deviceInfoUrl: "https://cdn.example.test/device.png",
      verification: verification(),
      now: new Date("2026-08-23T00:00:00.000Z"),
    });

    expect(result.status).toBe("approved");
    expect(result.steamUsername).toBe("xardgames1");
    expect(JSON.stringify(result.verificationJson)).not.toMatch(/ABC123|a1b2c3|Serial:/i);
    expect(result).not.toHaveProperty("gmail");
    expect(result).not.toHaveProperty("twoFactor");
    expect(writeAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "code_access.verify_submitted",
      targetId: "xardgames1",
    }));
  });

  it("rejects code access for accounts outside the allowlist", async () => {
    const decision = await requestAccessDecision({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames9",
      now: new Date("2026-08-23T00:00:00.000Z"),
    });

    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error("Expected account allowlist denial");
    expect(decision.reason).toBe("Account does not exist.");
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("binds access to the verified device fingerprint", async () => {
    const first = fingerprintDevice(verification());
    const second = fingerprintDevice(verification({
      deviceFingerprint: {
        ...verification().deviceFingerprint,
        serialNumber: "DIFFERENT",
        rawVisibleIdentifiers: ["Serial: DIFFERENT"],
      },
    }));

    expect(first.hash).not.toBe(second.hash);
    expect(first.label).toContain("pixel 9");
  });

  it("rejects re-verification from a different device and preserves the original binding", async () => {
    const originalDevice = fingerprintDevice(verification());
    selectChain.limit.mockResolvedValueOnce([
      entitlement({
        deviceFingerprintHash: originalDevice.hash,
        deviceFingerprintLabel: originalDevice.label,
      }),
    ]);

    const result = await upsertVerificationSubmission({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      purchaseProofUrl: "https://cdn.example.test/proof-new.png",
      deviceInfoUrl: "https://cdn.example.test/device-new.png",
      verification: verification({
        deviceFingerprint: {
          ...verification().deviceFingerprint,
          serialNumber: "DIFFERENT",
          rawVisibleIdentifiers: ["Serial: DIFFERENT"],
        },
      }),
      now: new Date("2026-08-23T00:00:00.000Z"),
    });

    expect(result.status).toBe("rejected");
    expect(result.deviceFingerprintHash).toBe(originalDevice.hash);
    expect(result.deviceFingerprintLabel).toBe(originalDevice.label);
    expect(result.verificationJson).toMatchObject({ deviceMismatch: true });
  });

  it("admin review maps decisions to entitlement statuses", async () => {
    const approved = await adminReviewEntitlement({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      reviewerId: "admin1",
      decision: "approve",
      subscriptionEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    const revoked = await adminReviewEntitlement({
      guildId: "g1",
      discordUserId: "u1",
      steamUsername: "XardGames1",
      reviewerId: "admin1",
      decision: "revoke",
    });

    expect(approved?.status).toBe("approved");
    expect(revoked?.status).toBe("revoked");
    expect(writeAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "code_access.review",
      targetId: "xardgames1",
    }));
  });
});
