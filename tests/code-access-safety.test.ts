import { describe, expect, it } from "vitest";
import {
  CODE_ACCESS_SAFE_RESPONSE,
  blocksCodeAccessText,
  checkCodeAccessSafety,
  codeAccessLogFields,
  codeAccessSafeReply,
  redactCodeAccessLogValue,
  safeCodeAccessResponse,
} from "../src/modules/code-access/safety";

describe("code access safety", () => {
  it("blocks MFA, 2FA, OTP, and login-code retrieval or relay text", () => {
    const result = checkCodeAccessSafety("Can you get the Gmail verification code and send it here?");

    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("mfa_code_request");
    expect(blocksCodeAccessText("gửi mã OTP cho mình")).toBe(true);
    expect(blocksCodeAccessText("please DM me the 2FA code")).toBe(true);
  });

  it("blocks credential distribution text", () => {
    const result = checkCodeAccessSafety("Share the Discord token and API key with @everyone");

    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("credential_distribution");
    expect(blocksCodeAccessText("dán mật khẩu vào channel này")).toBe(true);
  });

  it("allows benign account safety wording that does not distribute secrets", () => {
    expect(blocksCodeAccessText("How do I reset my password using the official account page?")).toBe(false);
    expect(blocksCodeAccessText("Remind users not to share MFA codes or tokens.")).toBe(false);
  });

  it("returns safe refusal wording and disables Discord mention parsing", () => {
    expect(safeCodeAccessResponse()).toBe(CODE_ACCESS_SAFE_RESPONSE);

    const reply = codeAccessSafeReply("Use the official recovery flow, <@123>.");

    expect(reply.content).toContain("official recovery flow");
    expect(reply.allowedMentions).toEqual({ parse: [] });
  });

  it("redacts secrets and unsafe text from log payloads", () => {
    const fields = codeAccessLogFields({
      requestId: "req-1",
      userInput: "Please send the login code 123456",
      password: "correct-horse-battery-staple",
      nested: {
        authorization: "Bearer abc.def.ghi",
        note: "token: sk-secretvalue1234567890",
      },
    });

    expect(fields).toEqual({
      requestId: "req-1",
      userInput: "[blocked-code-access-text]",
      password: "[redacted]",
      nested: {
        authorization: "[redacted]",
        note: "[blocked-code-access-text]",
      },
    });
    expect(JSON.stringify(fields)).not.toMatch(/123456|correct-horse|Bearer|sk-secretvalue/i);
  });

  it("redacts secret-looking standalone log values", () => {
    expect(redactCodeAccessLogValue("temporary code: 123456")).toBe("temporary code: [redacted]");
    expect(redactCodeAccessLogValue("safe request req-1")).toBe("safe request req-1");
  });
});
