import { describe, expect, it } from "vitest";
import { fallbackIntent, fastPlan, toolSubsetForIntent } from "../src/agent/routing";

describe("fallbackIntent", () => {
  it("detects action intents in Vietnamese and English", () => {
    expect(fallbackIntent("tạo channel mới cho team dev")).toBe("action");
    expect(fallbackIntent("delete channel cũ đi")).toBe("action");
    expect(fallbackIntent("gửi tin nhắn chào thành viên mới")).toBe("action");
    expect(fallbackIntent("lên lịch thông báo vào thứ hai")).toBe("action");
  });

  it("detects knowledge intents", () => {
    expect(fallbackIntent("luật server là gì?")).toBe("knowledge");
    expect(fallbackIntert_safe("giá bao nhiêu vậy shop")).toBe("knowledge");
  });

  function fallbackIntert_safe(s: string) {
    return fallbackIntent(s);
  }

  it("defaults to chat", () => {
    expect(fallbackIntent("hello bot")).toBe("chat");
    expect(fallbackIntent("hôm nay vui quá")).toBe("chat");
  });
});

describe("fastPlan", () => {
  it("maps list channels to a read-only plan without LLM", () => {
    const plan = fastPlan("list channels");
    expect(plan).toEqual([{ name: "list_guild_structure", args: {} }]);
  });

  it("maps Vietnamese server structure request", () => {
    const plan = fastPlan("Xem cấu trúc server");
    expect(plan).not.toBeNull();
    expect(plan![0].name).toBe("list_guild_structure");
  });

  it("maps get channel with target", () => {
    const plan = fastPlan("get channel #general");
    expect(plan).toEqual([
      { name: "get_channel", args: { channelRef: "#general" } },
    ]);
  });

  it("returns null for free-form input", () => {
    expect(fastPlan("tạo category Học tập với 2 channel")).toBeNull();
  });
});

describe("toolSubsetForIntent", () => {
  it("gives knowledge intent only search tool", () => {
    expect(toolSubsetForIntent("knowledge")).toEqual(["search_knowledge"]);
  });

  it("never includes tools outside catalog", () => {
    const subset = toolSubsetForIntent("action");
    expect(subset).not.toContain("execute_discord_action");
  });
});
