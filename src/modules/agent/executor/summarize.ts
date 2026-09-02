export function summarize(toolName: string, result: Record<string, unknown>): string {
  switch (toolName) {
    case "list_guild_structure": {
      const cats = (result.categories as { name: string; children: string[] }[]) ?? [];
      const ungrouped = (result.ungrouped as string[]) ?? [];
      const total = cats.reduce((s, c) => s + c.children.length, 0) + ungrouped.length;
      return `Server có ${cats.length} categories, ${total} channels`;
    }
    case "search_knowledge":
      return `Tìm thấy ${result.resultCount ?? 0} kết quả kiến thức`;
    case "create_channel":
      return `Đã tạo channel ${result.mention} (${result.name})`;
    case "update_channel":
      return `Đã cập nhật channel ${result.mention}`;
    case "delete_channel":
      return `Đã xóa channel ${result.deletedDescription}`;
    case "create_category":
      return `Đã tạo category ${result.name}`;
    case "update_category":
      return `Đổi tên category ${result.oldName} → ${result.newName}`;
    case "delete_category":
      return `Đã xóa category ${result.deletedName} (channel con được giữ lại)`;
    case "send_message":
      return `Đã gửi tin nhắn vào <#${result.channelId}>`;
    case "reply_message":
      return `Đã reply tin nhắn trong <#${result.channelId}>`;
    case "send_embed":
      return `Đã gửi embed vào <#${result.channelId}>`;
    case "schedule_message":
      return `⏰ Đã lên lịch gửi lúc ${result.runAt}`;
    default:
      return `Hoàn tất ${toolName}`;
  }
}
