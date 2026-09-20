import { describe, it, expect } from "vitest";
import { POSE_PRESETS } from "@/lib/pose-presets";
import { sanitizeFashionFields } from "@/lib/ad-templates";
import {
  buildFashionTemplatePrompt,
  parseFashionTemplateOutput,
  hasUnknownPoseIssue,
} from "@/lib/ad-template-fashion-gen";

describe("buildFashionTemplatePrompt", () => {
  it("lists every pose id", () => {
    const prompt = buildFashionTemplatePrompt({ brief: "夏季连衣裙，轻快，无口播" });
    for (const p of POSE_PRESETS) {
      expect(prompt).toContain(p.id);
    }
    expect(prompt).toContain("crash_push");
    expect(prompt).toContain("CAMERA_PRESETS");
  });
});

describe("parseFashionTemplateOutput", () => {
  it("forces kind fashion and wraps a top-level fashion block", () => {
    const raw = `\`\`\`json
{"name":{"zh":"走秀","en":"Runway"},"poseSequence":["front_stand","walk_toward"],"scriptPattern":"none"}
\`\`\``;
    const parsed = parseFashionTemplateOutput(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("fashion");
    expect((parsed!.fashion as { poseSequence: string[] }).poseSequence).toEqual(["front_stand", "walk_toward"]);
  });

  it("returns null on unparseable text", () => {
    expect(parseFashionTemplateOutput("hello")).toBeNull();
  });
});

describe("unknown-pose issue detection", () => {
  it("flags sanitizeFashionFields unknown pose id issues", () => {
    const { issues } = sanitizeFashionFields({
      poseSequence: ["front_stand", "moonwalk", "side"],
      lookSource: "accepted",
      lock: { face: true, garmentPattern: true, noOutfitChange: true },
      negative: { zh: "换衣服", en: "outfit swap" },
      scriptPattern: "none",
    });
    expect(hasUnknownPoseIssue(issues)).toBe(true);
    expect(issues.some((i) => i.includes("moonwalk"))).toBe(true);
  });

  it("is false when every pose id is known", () => {
    const { issues } = sanitizeFashionFields({
      poseSequence: ["front_stand", "side"],
      lookSource: "accepted",
      lock: { face: true, garmentPattern: true, noOutfitChange: true },
      negative: { zh: "换衣服", en: "outfit swap" },
      scriptPattern: "none",
    });
    expect(hasUnknownPoseIssue(issues)).toBe(false);
  });
});
