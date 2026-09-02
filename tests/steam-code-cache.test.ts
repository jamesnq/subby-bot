import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SteamCodeEntry } from "../src/modules/gmail/steam-mail";

const { dbMock, insertChain, selectChain, findLatestMock } = vi.hoisted(() => {
  const insertChain = {
    valuesArg: undefined as unknown,
    conflictArg: undefined as unknown,
    values: vi.fn((values: unknown) => {
      insertChain.valuesArg = values;
      return insertChain;
    }),
    onConflictDoUpdate: vi.fn(async (arg: unknown) => {
      insertChain.conflictArg = arg;
    }),
  };

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };

  return {
    insertChain,
    selectChain,
    findLatestMock: vi.fn(),
    dbMock: {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
    },
  };
});

vi.mock("../src/modules/database/db", () => ({ db: dbMock }));
vi.mock("../src/modules/gmail/steam-mail", () => ({
  findLatestSteamCodeForAccount: findLatestMock,
}));

import {
  findLatestSteamCodeWithCache,
  getLatestCachedSteamCode,
  upsertSteamCodeCacheEntries,
} from "../src/modules/code-access/steam-code-cache";

describe("Steam code mail cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertChain.valuesArg = undefined;
    insertChain.conflictArg = undefined;
    selectChain.limit.mockResolvedValue([]);
  });

  it("upserts parsed Steam code entries by Gmail message id", async () => {
    await upsertSteamCodeCacheEntries([
      steamCodeEntry({
        messageId: "gmail-1",
        account: "XardGames1",
        code: "CD345",
      }),
    ]);

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(insertChain.valuesArg).toMatchObject({
      gmailMessageId: "gmail-1",
      steamUsername: "xardgames1",
      accountLabel: "XardGames1",
      code: "CD345",
      subject: "Steam Guard",
    });
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it("uses Gmail first and caches the returned code", async () => {
    findLatestMock.mockResolvedValueOnce(steamCodeEntry({ code: "CD345" }));

    const result = await findLatestSteamCodeWithCache("XardGames1");

    expect(result?.source).toBe("gmail");
    expect(result?.entry.code).toBe("CD345");
    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("falls back to the latest cached code when Gmail has no matching mail", async () => {
    findLatestMock.mockResolvedValueOnce(null);
    selectChain.limit.mockResolvedValueOnce([
      cachedRow({ code: "AB234", receivedAt: new Date("2026-09-01T16:00:00.000Z") }),
    ]);

    const result = await findLatestSteamCodeWithCache("XardGames1");

    expect(result?.source).toBe("cache");
    expect(result?.entry.code).toBe("AB234");
    expect(selectChain.limit).toHaveBeenCalledWith(1);
  });

  it("falls back to cache when Gmail errors", async () => {
    findLatestMock.mockRejectedValueOnce(new Error("Gmail API down"));
    selectChain.limit.mockResolvedValueOnce([
      cachedRow({ code: "EF456", receivedAt: new Date("2026-09-01T17:00:00.000Z") }),
    ]);

    const result = await findLatestSteamCodeWithCache("XardGames1");

    expect(result?.source).toBe("cache");
    expect(result?.gmailError).toBe("Gmail API down");
    expect(result?.entry.code).toBe("EF456");
  });

  it("reads the latest cached code for a normalized account", async () => {
    selectChain.limit.mockResolvedValueOnce([
      cachedRow({ accountLabel: "XardGames1", code: "GH567" }),
    ]);

    const row = await getLatestCachedSteamCode("https://steamcommunity.com/id/XardGames1/");

    expect(row?.code).toBe("GH567");
    expect(selectChain.orderBy).toHaveBeenCalledOnce();
  });
});

function steamCodeEntry(overrides: Partial<SteamCodeEntry> = {}): SteamCodeEntry {
  return {
    messageId: "gmail-1",
    account: "XardGames1",
    code: "AB234",
    receivedAt: "2026-09-01T15:00:00.000Z",
    subject: "Steam Guard",
    from: "Steam <noreply@steampowered.com>",
    bodyPreview: "Steam Guard code is [redacted-code]",
    ...overrides,
  };
}

function cachedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cache-1",
    gmailMessageId: "gmail-1",
    steamUsername: "xardgames1",
    accountLabel: "XardGames1",
    code: "AB234",
    sender: "Steam <noreply@steampowered.com>",
    subject: "Steam Guard",
    bodyPreview: "Steam Guard code is [redacted-code]",
    receivedAt: new Date("2026-09-01T15:00:00.000Z"),
    createdAt: new Date("2026-09-01T15:00:00.000Z"),
    updatedAt: new Date("2026-09-01T15:00:00.000Z"),
    ...overrides,
  };
}
