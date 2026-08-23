import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { ensurePgVectorExtension } from "../../database/pool";
import { searchKnowledge } from "../../knowledge/retrieve";

const schema = z.object({
  query: z.string().min(1).max(512).describe("Câu hỏi hoặc từ khóa cần tra cứu"),
  limit: z.number().int().min(1).max(8).default(5),
});

export const searchKnowledgeTool = defineTool({
  name: "search_knowledge",
  description:
    "Tìm kiếm trong cơ sở tri thức của server (FAQ, luật server, hướng dẫn). Chỉ trả về dữ liệu người dùng được phép xem",
  risk: "read",
  group: "knowledge",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ViewChannel],
  preview: (_ctx, input) => ({
    title: "Tra cứu kiến thức server",
    lines: [`Truy vấn: "${input.query}"`],
  }),
  async execute(ctx, input) {
    const roleIds = [...ctx.member.roles.cache.keys()];
    const chunks = await searchKnowledge(ctx.guild.id, input.query, {
      limit: input.limit,
      memberRoleIds: roleIds,
    });
    return { results: chunks, resultCount: chunks.length };
  },
});

