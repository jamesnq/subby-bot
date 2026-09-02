import { describe, expect, it } from "vitest";
import { decideConfidence, fraudFlagsFromMatches } from "../src/modules/code-access/service";

describe("signup fraud rules", () => {
  for (const key of ["duplicateBill", "reusedOrder", "sharedDevice"] as const) {
    it(`${key} cannot auto-approve at high confidence`, () => {
      const flags = fraudFlagsFromMatches({ duplicateBill: false, reusedOrder: false, sharedDevice: false, [key]: true });
      expect(flags).toHaveLength(1);
      expect(decideConfidence(1, flags)).toBe("escalate");
    });
  }
});
