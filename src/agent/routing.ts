import type { PlannedCall } from "../policies/types";
import type { Intent } from "./state";

const ACTION_KEYWORDS = [
  "tạo channel", "tạo kênh", "xóa channel", "sửa channel", "đổi tên",
  "di chuyển", "chuyển sang", "create channel", "delete", "rename",
  "tạo category", "xóa category", "tạo danh mục",
  "gửi tin", "send", "reply", "trả lời tin nhắn", "embed", "lên lịch",
];

const KNOWLEDGE_KEYWORDS = [
  "faq", "luật", "quy định", "hướng dẫn", "cách mua", "giá",
  "sự kiện", "what is", "là gì", "bao nhiêu", "ai là",
  // câu hỏi "how-to" ưu tiên tra cứu tri thức thay vì lên kế hoạch hành động
  "làm sao", "làm thế nào", "như thế nào", "cách nào", "how do i", "how to",
];

export function fallbackIntent(input: string): Intent {
  const lower = input.toLowerCase();
  if (KNOWLEDGE_KEYWORDS.some((k) => lower.includes(k))) return "knowledge";
  if (ACTION_KEYWORDS.some((k) => lower.includes(k))) return "action";
  return "chat";
}

type FastPlanRule = {
  pattern: RegExp;
  build: (input: string) => PlannedCall[] | null;
};

const FAST_PLAN_RULES: FastPlanRule[] = [
  {
    pattern: /^(list channels?|danh sách channels?|xem cấu trúc server|cấu trúc server|server structure)$/i,
    build: () => [{ name: "list_guild_structure", args: {} }],
  },
  {
    pattern: /^get channel\s+(.+)$/i,
    build: (m) => [{ name: "get_channel", args: { channelRef: m.trim() } }],
  },
  {
    pattern: /^channel info\s+(.+)$/i,
    build: (m) => [{ name: "get_channel", args: { channelRef: m.trim() } }],
  },
];

export function fastPlan(input: string): PlannedCall[] | null {
  const trimmed = input.trim();
  for (const rule of FAST_PLAN_RULES) {
    const match = rule.pattern.exec(trimmed);
    if (match) {
      const calls = rule.build(match[1] ?? "");
      if (calls) return calls;
    }
  }
  return null;
}

export function toolSubsetForIntent(intent: Intent): string[] {
  switch (intent) {
    case "action":
      return [
        "list_guild_structure",
        "get_channel",
        "create_category",
        "update_category",
        "delete_category",
        "create_channel",
        "update_channel",
        "delete_channel",
        "set_channel_permissions",
        "sync_category_permissions",
        "send_message",
        "reply_message",
        "send_embed",
        "schedule_message",
        "create_poll",
        "escalate_to_moderator",
        "create_ticket",
      ];
    case "knowledge":
      return ["search_knowledge"];
    default:
      return [];
  }
}

