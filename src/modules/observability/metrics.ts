import { logger } from "@shared/logger";

type Counters = {
  requests: number;
  llmCalls: number;
  toolExecutions: number;
  toolFailures: number;
  approvals: number;
  cacheHits: number;
};

const counters: Counters = {
  requests: 0,
  llmCalls: 0,
  toolExecutions: 0,
  toolFailures: 0,
  approvals: 0,
  cacheHits: 0,
};

export function incRequest(): void {
  counters.requests++;
}

export function incLlmCall(): void {
  counters.llmCalls++;
}

export function incToolExecution(failure = false): void {
  counters.toolExecutions++;
  if (failure) counters.toolFailures++;
}

export function incApproval(): void {
  counters.approvals++;
}

export function incCacheHit(): void {
  counters.cacheHits++;
}

let timer: NodeJS.Timeout | null = null;

export function startMetricsLogger(intervalMs = 300_000): void {
  if (timer) return;
  timer = setInterval(() => {
    logger.info({ metrics: { ...counters } }, "metrics summary");
  }, intervalMs);
}

export function stopMetricsLogger(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
