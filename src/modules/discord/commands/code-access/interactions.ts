import { EmbedBuilder, MessageFlags, type Interaction } from "discord.js";
import { handleEscalationButton, handleEscalationFixModal } from "./escalation";
import { handleRequestButton } from "./request-interactions";
import { handleSignupButton, handleSignupFieldSelect, handleSignupModal } from "./signup-interactions";
import { GUIDE_IMAGES } from "./components";

export type CodeAccessCustomId = { area: "sg" | "rq" | "es" | "help"; action: string; id?: string; extra?: string };

export function parseCodeAccessCustomId(customId: string): CodeAccessCustomId | null {
  const parts = customId.split(":");
  if (parts[0] !== "ca" || !["sg", "rq", "es", "help"].includes(parts[1])) return null;
  if (parts[1] === "help") return { area: "help", action: parts[2] ?? "general" };
  if (!parts[2] || !parts[3]) return null;
  return { area: parts[1] as "sg" | "rq" | "es", action: parts[2], id: parts[3], extra: parts[4] };
}

export async function handleCodeAccessComponent(interaction: Interaction): Promise<void> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return;
  const parsed = parseCodeAccessCustomId(interaction.customId);
  if (!parsed) return;
  if (parsed.area === "help" && interaction.isButton()) {
    const request = parsed.action === "request";
    const embed = new EmbedBuilder().setTitle(request ? "📖 Cách chụp ảnh xin mã" : "📖 Cách chụp ảnh đăng ký").setColor(0x5865f2)
      .setDescription(request
        ? `PC: chụp toàn màn hình thấy Steam hỏi mã + Settings > About + đồng hồ. Handheld: gửi riêng ảnh Steam và ảnh máy.\nẢnh mẫu: ${GUIDE_IMAGES.steam}\n${GUIDE_IMAGES.device}`
        : `Chụp bill và Settings → System → About bằng PrtSc; phải thấy đồng hồ taskbar và dòng Version.\nẢnh mẫu: ${GUIDE_IMAGES.order}\n${GUIDE_IMAGES.device}`);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  if (!parsed.id) return;
  if (parsed.area === "sg") {
    if (interaction.isButton()) await handleSignupButton(interaction, parsed.action, parsed.id);
    else if (interaction.isStringSelectMenu() && parsed.action === "field") await handleSignupFieldSelect(interaction, parsed.id);
    else if (interaction.isModalSubmit() && parsed.action === "modal" && parsed.extra) await handleSignupModal(interaction, parsed.id, parsed.extra);
  } else if (parsed.area === "rq" && interaction.isButton()) {
    await handleRequestButton(interaction, parsed.action, parsed.id);
  } else if (parsed.area === "es") {
    if (interaction.isButton()) await handleEscalationButton(interaction, parsed.action, parsed.id, parsed.extra);
    else if (interaction.isModalSubmit() && parsed.action === "modal") await handleEscalationFixModal(interaction, parsed.id);
  }
}
