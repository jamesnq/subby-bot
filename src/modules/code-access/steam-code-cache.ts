import { and, desc, eq } from "drizzle-orm";

import { db } from "../database/db";
import {
  steamCodeMailCache,
  type SteamCodeMailCacheRow,
} from "../database/schema";
import { logger } from "@shared/logger";
import {
  findLatestSteamCodeForAccount,
  type ListSteamMailOptions,
  type SteamCodeEntry,
} from "../gmail/steam-mail";
import { normalizeSteamUsername } from "./accounts";

export type SteamCodeLookupResult = {
  account: string;
  entry: SteamCodeEntry;
  source: "gmail" | "cache";
  gmailError?: string;
};

export type SteamCodeBatchLookupResult = {
  results: SteamCodeLookupResult[];
  errors: string[];
};

export async function findLatestSteamCodeWithCache(
  account: string,
  options: ListSteamMailOptions = {},
): Promise<SteamCodeLookupResult | null> {
  let gmailError: unknown;

  try {
    const entry = await findLatestSteamCodeForAccount(account, options);
    if (entry) {
      await cacheSteamCodeEntriesBestEffort([entry]);
      return { account, entry, source: "gmail" };
    }
  } catch (error) {
    gmailError = error;
  }

  const cached = await getLatestCachedSteamCode(account);
  if (cached) {
    return {
      account,
      entry: steamCodeEntryFromCache(cached),
      source: "cache",
      gmailError: gmailError instanceof Error ? gmailError.message : undefined,
    };
  }

  if (gmailError) throw gmailError;
  return null;
}

export async function findLatestSteamCodesForAccountsWithCache(
  accounts: string[],
  options: ListSteamMailOptions = {},
): Promise<SteamCodeBatchLookupResult> {
  const settled = await Promise.allSettled(
    accounts.map((account) => findLatestSteamCodeWithCache(account, options)),
  );

  const results: SteamCodeLookupResult[] = [];
  const errors: string[] = [];

  for (const item of settled) {
    if (item.status === "fulfilled") {
      if (item.value) results.push(item.value);
    } else {
      errors.push(item.reason instanceof Error ? item.reason.message : "Unknown Gmail error");
    }
  }

  return { results, errors };
}

export async function cacheSteamCodeEntriesBestEffort(
  entries: SteamCodeEntry[],
): Promise<void> {
  try {
    await upsertSteamCodeCacheEntries(entries);
  } catch (err) {
    logger.warn({ err }, "failed to cache Steam code mail");
  }
}

export async function upsertSteamCodeCacheEntries(
  entries: SteamCodeEntry[],
): Promise<void> {
  await Promise.all(
    entries
      .map(cacheValuesFromEntry)
      .filter((values): values is NonNullable<ReturnType<typeof cacheValuesFromEntry>> => values !== null)
      .map(async (values) => {
        await db
          .insert(steamCodeMailCache)
          .values(values)
          .onConflictDoUpdate({
            target: steamCodeMailCache.gmailMessageId,
            set: {
              steamUsername: values.steamUsername,
              accountLabel: values.accountLabel,
              code: values.code,
              sender: values.sender,
              subject: values.subject,
              bodyPreview: values.bodyPreview,
              receivedAt: values.receivedAt,
              updatedAt: values.updatedAt,
            },
          });
      }),
  );
}

export async function getLatestCachedSteamCode(
  account: string,
): Promise<SteamCodeMailCacheRow | undefined> {
  const steamUsername = normalizeSteamUsername(account);
  if (!steamUsername) return undefined;

  const rows = await db
    .select()
    .from(steamCodeMailCache)
    .where(eq(steamCodeMailCache.steamUsername, steamUsername))
    .orderBy(desc(steamCodeMailCache.receivedAt))
    .limit(1);

  return rows[0];
}

function cacheValuesFromEntry(entry: SteamCodeEntry) {
  const steamUsername = normalizeSteamUsername(entry.account);
  const receivedAt = parseReceivedAt(entry.receivedAt);
  if (!entry.messageId || !steamUsername || !receivedAt) return null;

  const now = new Date();
  return {
    gmailMessageId: entry.messageId,
    steamUsername,
    accountLabel: entry.account,
    code: entry.code,
    sender: entry.from,
    subject: entry.subject,
    bodyPreview: entry.bodyPreview,
    receivedAt,
    updatedAt: now,
  };
}

function steamCodeEntryFromCache(row: SteamCodeMailCacheRow): SteamCodeEntry {
  return {
    messageId: row.gmailMessageId,
    account: row.accountLabel,
    code: row.code,
    receivedAt: row.receivedAt.toISOString(),
    subject: row.subject ?? undefined,
    from: row.sender ?? undefined,
    bodyPreview: row.bodyPreview ?? undefined,
  };
}

function parseReceivedAt(value: string | undefined): Date | null {
  if (!value) return null;

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
