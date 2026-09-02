import type { RiskLevel } from "../tools/registry";
import type { PlannedCall } from "./types";
import { plannedCallSchema } from "./types";

const RESOURCE_CREATING_TOOLS = new Set(["create_channel", "create_category"]);
const SPAM_DUPLICATE_LIMIT = 3;

export type ToolMetaLookup = (name: string) => { risk: RiskLevel } | undefined;

export type PlanPolicyResult =
  | { ok: true; risks: RiskLevel[] }
  | { ok: false; reason: string; prohibited: boolean };

export function checkPlanPolicy(
  calls: PlannedCall[],
  limits: { maxCalls: number; maxResources: number },
  lookup: ToolMetaLookup,
): PlanPolicyResult {
  if (calls.length === 0) {
    return { ok: false, reason: "Kế hoạch không có bước nào để thực hiện.", prohibited: false };
  }

  if (calls.length > limits.maxCalls) {
    return {
      ok: false,
      reason: `Yêu cầu ${calls.length} bước nhưng giới hạn là ${limits.maxCalls}. Hãy chia nhỏ yêu cầu.`,
      prohibited: false,
    };
  }

  const unknown = calls.filter((c) => !lookup(c.name));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `Không tồn tại tool: ${unknown.map((c) => c.name).join(", ")}`,
      prohibited: false,
    };
  }

  const resources = calls.filter((c) => RESOURCE_CREATING_TOOLS.has(c.name)).length;
  if (resources > limits.maxResources) {
    return {
      ok: false,
      reason: `Kế hoạch tạo ${resources} tài nguyên mới nhưng giới hạn mỗi lần là ${limits.maxResources}.`,
      prohibited: false,
    };
  }

  const contents = calls
    .filter((c) => ["send_message", "schedule_message"].includes(c.name))
    .map((c) => String((c.args as { content?: string }).content ?? "").trim())
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const content of contents) {
    counts.set(content, (counts.get(content) ?? 0) + 1);
  }
  for (const [content, n] of counts) {
    if (n > SPAM_DUPLICATE_LIMIT) {
      return {
        ok: false,
        reason: `Phát hiện nội dung lặp lại ${n} lần ("${content.slice(0, 80)}"). Bot không spam.`,
        prohibited: true,
      };
    }
  }

  const validated = calls.map((c) => plannedCallSchema.parse(c));

  return {
    ok: true,
    risks: validated.map((c) => lookup(c.name)!.risk),
  };
}
