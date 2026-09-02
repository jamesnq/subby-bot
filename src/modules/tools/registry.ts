import type { z } from "zod";
import type { Guild, GuildMember, NewsChannel, TextChannel } from "discord.js";
import type { AuthResult } from "@shared/errors";
import type { GuildSettingsRow } from "../database/schema";
import { zodToJsonSchema } from "zod-to-json-schema";

export type RiskLevel = "read" | "write" | "destructive";

export type ToolGroup =
  | "read"
  | "channel"
  | "category"
  | "message"
  | "schedule"
  | "knowledge";

export type SendableGuildChannel = TextChannel | NewsChannel;

export interface ToolContext {
  requestId: string;
  guild: Guild;
  member: GuildMember;
  channel: SendableGuildChannel;
  allowMentions: boolean;
  settings: GuildSettingsRow;
}

export interface ToolPreview {
  title: string;
  lines: string[];
}

export interface DiscordTool<I = unknown> {
  name: string;
  description: string;
  risk: RiskLevel;
  group: ToolGroup;
  schema: z.ZodType<I, z.ZodTypeDef, unknown>;
  requiredBotPermissions: bigint[];
  authorize?(ctx: ToolContext, input: I): AuthResult | Promise<AuthResult>;
  preview(ctx: ToolContext, input: I): ToolPreview | Promise<ToolPreview>;
  execute(ctx: ToolContext, input: I): Promise<Record<string, unknown>>;
}

export type AnyDiscordTool = DiscordTool<any>;

export const RISK_ORDER: Record<RiskLevel, number> = {
  read: 0,
  write: 1,
  destructive: 2,
};

export function maxRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (acc, cur) => (RISK_ORDER[cur] > RISK_ORDER[acc] ? cur : acc),
    "read",
  );
}

export interface PlanningToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function toPlanningSpec(tool: AnyDiscordTool): PlanningToolSpec {
  const jsonSchema = zodToJsonSchema(tool.schema as never, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return {
    type: "function",
    function: {
      name: tool.name,
      description: `${tool.description} [risk:${tool.risk}]`,
      parameters: jsonSchema,
    },
  };
}

const registry = new Map<string, AnyDiscordTool>();

export function registerTool(tool: AnyDiscordTool): void {
  if (registry.has(tool.name)) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  registry.set(tool.name, tool);
}

export function defineTool<I>(tool: DiscordTool<I>): DiscordTool<I> {
  registerTool(tool as unknown as AnyDiscordTool);
  return tool;
}

export function getTool(name: string): AnyDiscordTool | undefined {
  return registry.get(name);
}

export function getAllTools(): AnyDiscordTool[] {
  return [...registry.values()];
}

export function getPlanningSpecs(names: string[]): PlanningToolSpec[] {
  return names
    .map((n) => registry.get(n))
    .filter((t): t is AnyDiscordTool => Boolean(t))
    .map(toPlanningSpec);
}
