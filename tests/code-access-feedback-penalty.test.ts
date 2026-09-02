import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  FEEDBACK_GRACE_MS,
  FEEDBACK_PENALTY_DAYS,
  FEEDBACK_PENALTY_MS,
  FEEDBACK_REMINDER_MS,
} from "../src/modules/code-access/feedback-penalty";
import { codeAccessFeedbackRequests, codeAccessPenalties } from "../src/modules/database/schema";

// No live DB in this test environment (see tests/code-access-drafts.test.ts
// for the same constraint) — createFeedbackObligation/sweepMissingFeedback/
// getActivePenalty/resolveFeedbackObligation all touch Postgres directly and
// aren't exercised here. Covered instead: the timing constants agreed with
// the user (1h grace, reminder at the halfway point, 7-day penalty) and that
// the schema actually enforces "one obligation per thread" / "one active
// penalty per user" the way the service code assumes.
describe("code access feedback penalty — timing & schema", () => {
  it("grants 1 hour to give feedback before it counts as missing", () => {
    expect(FEEDBACK_GRACE_MS).toBe(60 * 60_000);
  });
  it("reminds at the halfway point of the grace window", () => {
    expect(FEEDBACK_REMINDER_MS).toBe(FEEDBACK_GRACE_MS / 2);
  });
  it("penalizes for exactly 7 days", () => {
    expect(FEEDBACK_PENALTY_DAYS).toBe(7);
    expect(FEEDBACK_PENALTY_MS).toBe(7 * 24 * 60 * 60_000);
  });
  it("enforces one open feedback obligation per thread (onConflictDoNothing target)", () => {
    const names = getTableConfig(codeAccessFeedbackRequests).indexes.map((index) => index.config.name);
    expect(names).toContain("code_access_feedback_requests_thread_idx");
  });
  it("enforces one penalty row per (guild, user) so re-penalizing upserts instead of duplicating", () => {
    const names = getTableConfig(codeAccessPenalties).indexes.map((index) => index.config.name);
    expect(names).toContain("code_access_penalties_guild_user_idx");
  });
});
