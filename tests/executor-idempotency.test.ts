import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, selectChain, insertChain, returning } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  // executePlan claims the idempotency key with
  // insert().values().onConflictDoNothing().returning(); a non-empty return
  // means this process won the claim.
  const returning = vi.fn().mockResolvedValue([{ id: "exec-1" }]);
  const insertChain = {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({ returning }),
    }),
  };
  return {
    selectChain,
    insertChain,
    returning,
    dbMock: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      delete: vi.fn(() => ({ where: () => Promise.resolve() })),
    },
  };
});

vi.mock("../src/modules/database/db", () => ({ db: dbMock }));
vi.mock("../src/modules/database/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { executePlan } from "../src/modules/agent/executor";
import { registerTool } from "../src/modules/tools/registry";
import { z } from "zod";
import type { ExecutionContext } from "../src/modules/agent/executor";

registerTool({
  name: "t_echo",
  description: "test echo",
  risk: "write",
  group: "channel",
  schema: z.object({ value: z.string() }),
  requiredBotPermissions: [],
  preview: () => ({ title: "echo", lines: [] }),
  execute: async (_ctx, input) => ({ echoed: (input as { value: string }).value }),
});

registerTool({
  name: "t_boom",
  description: "test failure",
  risk: "write",
  group: "channel",
  schema: z.object({}),
  requiredBotPermissions: [],
  preview: () => ({ title: "boom", lines: [] }),
  execute: async () => {
    throw new Error("detonate");
  },
});

function makeCtx(requestId: string): ExecutionContext {
  return {
    requestId,
    guild: {
      id: "g1",
      ownerId: "u1",
      members: { me: { permissions: { has: () => true }, id: "bot" } },
      channels: { cache: new Map() },
    },
    member: { id: "u1", permissions: { has: () => true }, user: { username: "tester" } },
    channel: { id: "c1" },
    settings: { destructiveEnabled: true, allowMentions: false },
    allowMentions: false,
  } as unknown as ExecutionContext;
}

describe("executor idempotency & failure semantics", () => {
  beforeEach(() => {
    selectChain.limit.mockResolvedValue([]);
    insertChain.values.mockClear();
    returning.mockResolvedValue([{ id: "exec-1" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("replays prior success as skipped_idempotent without re-executing", async () => {
    const execSpy = vi.fn(async () => ({ ok: true }));
    registerTool({
      name: "t_prior",
      description: "prior",
      risk: "read",
      group: "read",
      schema: z.object({}),
      requiredBotPermissions: [],
      preview: () => ({ title: "p", lines: [] }),
      execute: execSpy as never,
    });

    selectChain.limit.mockResolvedValueOnce([{ resultJson: { channelId: "42" }, status: "success" }]);

    const result = await executePlan(makeCtx("req-prior"), [{ name: "t_prior", args: {} }]);

    expect(result.outcomes[0].status).toBe("skipped_idempotent");
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("records success with idempotency key requestId:index", async () => {
    await executePlan(makeCtx("req-key"), [
      { name: "t_echo", args: { value: "hello" } },
    ]);
    expect(insertChain.values).toHaveBeenCalledTimes(1);
    const arg = insertChain.values.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.idempotencyKey).toBe("req-key:0");
    // The row is claimed as "running" and only flipped to "success" once the
    // tool has actually returned.
    expect(arg.status).toBe("running");
    expect(dbMock.update).toHaveBeenCalled();
  });

  it("skips the step when another process already claimed the key", async () => {
    const execSpy = vi.fn(async () => ({ ok: true }));
    registerTool({
      name: "t_raced",
      description: "raced",
      risk: "write",
      group: "channel",
      schema: z.object({}),
      requiredBotPermissions: [],
      preview: () => ({ title: "r", lines: [] }),
      execute: execSpy as never,
    });

    // No prior success row, but the claim insert loses to a concurrent writer.
    returning.mockResolvedValueOnce([]);

    const result = await executePlan(makeCtx("req-race"), [{ name: "t_raced", args: {} }]);

    expect(result.outcomes[0].status).toBe("skipped_idempotent");
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("stops the loop at first failure and reports allSuccess=false", async () => {
    const result = await executePlan(makeCtx("req-fail"), [
      { name: "t_echo", args: { value: "ok" } },
      { name: "t_boom", args: {} },
      { name: "t_echo", args: { value: "never" } },
    ]);

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0].status).toBe("success");
    expect(result.outcomes[1].status).toBe("failed");
    expect(result.outcomes[1].error).toContain("detonate");
    expect(result.allSuccess).toBe(false);
  });

  it("marks denied step with reason and stops", async () => {
    registerTool({
      name: "t_denied",
      description: "denied tool",
      risk: "destructive",
      group: "channel",
      schema: z.object({}),
      requiredBotPermissions: [],
      authorize: () => ({ ok: false, reason: "không đủ quyền" }),
      preview: () => ({ title: "d", lines: [] }),
      execute: async () => ({}),
    });

    const result = await executePlan(makeCtx("req-deny"), [
      { name: "t_echo", args: { value: "x" } },
      { name: "t_denied", args: {} },
    ]);

    expect(result.outcomes[1].status).toBe("denied");
    expect(result.outcomes[1].error).toContain("không đủ quyền");
  });
});
