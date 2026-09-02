import { getTool } from "../../tools/registry";
import type { ToolPreview } from "../../tools/registry";
import { createApprovalRequest } from "../../approvals/service";
import { config } from "@config";
import { writeAudit } from "../../database/audit";
import { buildExecutionContext } from "../context-builder";
import type { AgentState } from "../state";

const RISK_LABEL: Record<string, string> = {
  write: "🟡 GHI DỮ LIỆU",
  destructive: "🔴 PHÁ HỦY",
};

export async function requestApproval(state: AgentState): Promise<Partial<AgentState>> {
  const ec = await buildExecutionContext(state).catch(() => null);
  if (!ec) {
    return { error: "Không xác định được ngữ cảnh server để tạo preview." };
  }

  const calls = state.proposedCalls ?? [];
  const lines: string[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const tool = getTool(call.name);
    if (!tool) continue;
    let preview: ToolPreview;
    try {
      const parsed = tool.schema.parse(call.args);
      preview = await tool.preview(ec, parsed);
    } catch {
      preview = { title: "Bước cần xác nhận", lines: ["⚠️ Không xem trước được bước này, kiểm tra lại tham số."] };
    }
    lines.push(`**${i + 1}. ${preview.title}**`);
    for (const line of preview.lines.slice(0, 6)) {
      lines.push(`   ${line}`);
    }
  }

  const destructive = (state.riskLevel ?? "write") === "destructive";
  if (destructive) {
    lines.push("");
    lines.push("🔴 **Lưu ý:** kế hoạch chứa hành động phá hủy, không thể hoàn tác. Chỉ moderator được xác nhận.");
  }

  try {
    await createApprovalRequest({
      requestId: state.requestId,
      guildId: state.guildId,
      channelId: state.channelId,
      requesterId: state.userId,
      risk: state.riskLevel ?? "write",
      calls,
      ttlSeconds: config.APPROVAL_TTL_SECONDS,
    });
  } catch (err) {
    return { error: `Không tạo được yêu cầu phê duyệt: ${err instanceof Error ? err.message : String(err)}` };
  }

  await writeAudit({
    requestId: state.requestId,
    guildId: state.guildId,
    actorId: state.userId,
    action: "approval.requested",
    targetType: "plan",
    details: { risk: state.riskLevel, steps: calls.map((c) => c.name) },
  });

  return {
    awaitingApproval: true,
    approval: "pending",
    preview: {
      title: RISK_LABEL[state.riskLevel ?? "write"] ?? "🟡 WRITE",
      risk: state.riskLevel ?? "write",
      lines,
    },
  };
}
