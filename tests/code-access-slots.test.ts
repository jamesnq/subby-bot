import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { codeAccessDevices, codeAccessSlots } from "../src/modules/database/schema";

describe("code access slot schema", () => {
  it("globally prevents one physical device from serving two slots", () => {
    const deviceIndexes = getTableConfig(codeAccessDevices).indexes.map((index) => index.config.name);
    const slotIndexes = getTableConfig(codeAccessSlots).indexes.map((index) => index.config.name);
    expect(deviceIndexes).toContain("code_access_devices_fingerprint_idx");
    expect(slotIndexes).toContain("code_access_slots_device_idx");
  });
  it("allows one user to own N slots while preventing order reuse", () => {
    const names = getTableConfig(codeAccessSlots).indexes.map((index) => index.config.name);
    expect(names).toContain("code_access_slots_order_idx");
    expect(names).not.toContain("code_access_user_steam_idx");
  });
});
