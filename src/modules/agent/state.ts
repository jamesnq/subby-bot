import { Annotation } from "@langchain/langgraph";
import type { RiskLevel } from "../tools/registry";
import type { RetrievedChunk } from "../knowledge/retrieve";
import type { PlannedCall } from "../policies/types";

export type Intent = "chat" | "knowledge" | "action";

export type ApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "denied";

export type StepSummary = {
  index: number;
  toolName: string;
  risk: RiskLevel;
  status: "success" | "failed" | "denied" | "skipped_idempotent";
  summary: string;
  error?: string;
};

export type PreviewPayload = {
  title: string;
  risk: RiskLevel;
  lines: string[];
};

export const AgentStateAnnotation = Annotation.Root({
  requestId: Annotation<string>,
  guildId: Annotation<string>,
  channelId: Annotation<string>,
  userId: Annotation<string>,
  memberRoleIds: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  input: Annotation<string>,
  imageUrls: Annotation<string[] | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  attachmentNote: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  intent: Annotation<Intent | undefined>,
  retrievedContext: Annotation<RetrievedChunk[] | undefined>,
  proposedCalls: Annotation<PlannedCall[] | undefined>,
  directAnswer: Annotation<string | undefined>,
  cachedAnswer: Annotation<string | undefined>,
  riskLevel: Annotation<RiskLevel | undefined>,
  approval: Annotation<ApprovalState | undefined>,
  awaitingApproval: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
  preview: Annotation<PreviewPayload | undefined>,
  toolResults: Annotation<StepSummary[] | undefined>,
  finalResponse: Annotation<string | undefined>,
  error: Annotation<string | undefined>,
});

export type AgentState = typeof AgentStateAnnotation.State;
