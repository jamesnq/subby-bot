export type AuthResult = { ok: true } | { ok: false; reason: string };

export const authOk = (): AuthResult => ({ ok: true });
export const authFail = (reason: string): AuthResult => ({ ok: false, reason });

export type ResolveResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export class ToolDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolDeniedError";
  }
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}
