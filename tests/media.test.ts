import { describe, expect, it } from "vitest";
import {
  buildMultimodalContent,
  collectImageAttachments,
  describeAttachments,
  isImageAttachment,
} from "../src/shared/media";

const img = (name: string, contentType = "image/png"): Parameters<typeof isImageAttachment>[0] => ({
  url: `https://cdn.discordapp.com/${name}`,
  name,
  contentType,
  size: 1000,
});

describe("image attachment detection", () => {
  it("accepts image content types", () => {
    expect(isImageAttachment(img("a.png", "image/png"))).toBe(true);
    expect(isImageAttachment(img("a.jpg", "image/jpeg"))).toBe(true);
    expect(isImageAttachment(img("a.webp", "image/webp"))).toBe(true);
  });

  it("rejects video/pdf/null content types", () => {
    expect(isImageAttachment(img("v.mp4", "video/mp4"))).toBe(false);
    expect(isImageAttachment(img("d.pdf", "application/pdf"))).toBe(false);
    expect(isImageAttachment({ url: "u", name: "x", contentType: null })).toBe(false);
  });
});

describe("collectImageAttachments", () => {
  it("caps at 3 images and reports skipped", () => {
    const atts = Array.from({ length: 5 }, (_, i) => img(`i${i}.png`));
    const { images, skippedCount } = collectImageAttachments(atts);
    expect(images).toHaveLength(3);
    expect(skippedCount).toBe(2);
  });

  it("filters out videos and oversized images", () => {
    const atts = [
      img("v.mp4", "video/mp4"),
      { ...img("big.png"), size: 10 * 1024 * 1024 },
      img("ok.png"),
    ];
    const { images } = collectImageAttachments(atts);
    expect(images).toHaveLength(1);
    expect(images[0].name).toBe("ok.png");
  });
});

describe("describeAttachments", () => {
  it("lists non-image files with metadata", () => {
    const note = describeAttachments([img("v.mp4", "video/mp4"), img("doc.pdf", "application/pdf")]);
    expect(note).toContain('video "v.mp4"');
    expect(note).toContain('"doc.pdf"');
  });

  it("returns empty for image-only input", () => {
    expect(describeAttachments([img("a.png")])).toBe("");
  });
});

describe("buildMultimodalContent", () => {
  it("text first then one part per image", () => {
    const parts = buildMultimodalContent("mô tả ảnh", ["u1", "u2"]);
    expect(parts[0]).toEqual({ type: "text", text: "mô tả ảnh" });
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);
  });
});
