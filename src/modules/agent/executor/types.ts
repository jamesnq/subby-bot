import type { Guild, GuildMember } from "discord.js";
import type { GuildSettingsRow } from "../../database/schema";
import type { RiskLevel, SendableGuildChannel } from "../../tools/registry";

export type ExecutionContext = {
  requestId: string;
  guild: Guild;
  member: GuildMember;
  channel: SendableGuildChannel;
  settings: GuildSettingsRow;
  allowMentions: boolean;
};

export type StepOutcome = {
  index: number;
  toolName: string;
  risk: RiskLevel;
  status: "success" | "failed" | "denied" | "skipped_idempotent";
  summary: string;
  error?: string;
};

export type ExecutionResult = {
  outcomes: StepOutcome[];
  allSuccess: boolean;
  risk: RiskLevel;
  compensated: string[];
};
