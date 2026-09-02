import type { Interaction } from "discord.js";
import { handleEscalationButton, handleEscalationFixModal } from "./escalation";
import { handleRequestButton } from "./request-interactions";
import { handleSignupButton, handleSignupFieldSelect, handleSignupModal } from "./signup-interactions";

export type CodeAccessCustomId = { area: "sg" | "rq" | "es"; action: string; id: string; extra?: string };

export function parseCodeAccessCustomId(customId: string): CodeAccessCustomId | null {
  const parts = customId.split(":");
  if (parts[0] !== "ca" || !["sg", "rq", "es"].includes(parts[1])) return null;
  if (!parts[2] || !parts[3]) return null;
  return { area: parts[1] as "sg" | "rq" | "es", action: parts[2], id: parts[3], extra: parts[4] };
}

export async function handleCodeAccessComponent(interaction: Interaction): Promise<void> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return;
  const parsed = parseCodeAccessCustomId(interaction.customId);
  if (!parsed) return;
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
