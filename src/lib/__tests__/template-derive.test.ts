import { describe, it, expect } from "vitest";
import { sanitizeCustomAdTemplate, isFashionTemplate } from "@/lib/ad-templates";
import { findPresetByPrompt } from "@/lib/camera-presets";
import { deriveFashionTemplate, matchPoseId, matchCameraId, classifyOnScreenText } from "@/lib/reference/template-derive";
import type { ReferenceShotRead } from "@/lib/reference/types";

const CRASH_PUSH_ZH = findPresetByPrompt("镜头急速推近主体，冲击力强，开场抓眼")?.id;

function shot(partial: Partial<ReferenceShotRead> & { index: number; start: number; end: number }): ReferenceShotRead {
  return {
    role: "demo",
    framing: "full",
    poseText: "正面站姿",
    poseConfidence: 0.9,
    cameraText: "",
    onScreenText: [],
    hasSpeech: false,
    onCamera: false,
    frames: ["0-0.jpg"],
    ...partial,
  };
}

const threeShot: ReferenceShotRead[] = [
  shot({
    index: 0,
    start: 0,
    end: 3,
    role: "hook",
    poseText: "正面站姿",
    cameraText: "镜头急速推近主体，冲击力强，开场抓眼",
    captionStyle: "minimal",
  }),
  shot({
    index: 1,
    start: 3,
    end: 6.4,
    role: "demo",
    poseText: "背面",
    cameraText: "",
    captionStyle: "minimal",
  }),
  shot({
    index: 2,
    start: 6.4,
    end: 10,
    role: "cta",
    poseText: "走向镜头",
    cameraText: "",
    captionStyle: "minimal",
  }),
];

const meta = { referenceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", durationSec: 10, hasTranscript: false, locale: "zh" as const };

describe("matchPoseId / classifyOnScreenText", () => {
  it("侧身 → side", () => {
    expect(matchPoseId("侧身")).toBe("side");
  });

  it("camera 自由文本命中预设（不必整句）", () => {
    expect(matchCameraId("镜头急速推近主体")).toBe("crash_push");
    expect(matchCameraId("镜头跟随人物移动")).toBe("follow_track");
    expect(matchCameraId("微距缓慢滑移")).toBe("macro_glide");
    expect(matchCameraId("缓慢推近")).toBe("slow_push");
    expect(matchCameraId("镜头随便动一动")).toBeUndefined();
    expect(matchCameraId("")).toBeUndefined();
  });

  it("¥ / price text → price_card", () => {
    expect(classifyOnScreenText("限时 ¥199")).toBe("price_card");
    expect(classifyOnScreenText("NIKE")).toBe("brand_tag");
    expect(classifyOnScreenText("轻薄透气")).toBe("selling_point");
  });
});

describe("deriveFashionTemplate", () => {
  it("fixed 3-shot read → draft passes sanitize as fashion", () => {
    const { draft } = deriveFashionTemplate(threeShot, meta);
    expect(sanitizeCustomAdTemplate(draft)).not.toBeNull();
    expect(isFashionTemplate(draft)).toBe(true);
    expect(draft.fashion?.poseSequence).toHaveLength(3);
    expect(draft.kind).toBe("fashion");
  });

  it("pose 文本「侧身」→ side", () => {
    const reads = [
      shot({ index: 0, start: 0, end: 3, role: "hook", poseText: "侧身", poseConfidence: 0.85 }),
      shot({ index: 1, start: 3, end: 6, role: "demo", poseText: "正面", poseConfidence: 0.9 }),
      shot({ index: 2, start: 6, end: 9, role: "cta", poseText: "背面", poseConfidence: 0.9 }),
    ];
    const { draft } = deriveFashionTemplate(reads, meta);
    expect(draft.fashion?.poseSequence[0]).toBe("side");
  });

  it("unknown pose → front_stand + needsConfirmation", () => {
    const reads = [
      shot({ index: 0, start: 0, end: 3, role: "hook", poseText: "月球漫步xyz", poseConfidence: 0.9 }),
      shot({ index: 1, start: 3, end: 6, role: "cta", poseText: "正面", poseConfidence: 0.2 }),
    ];
    const { draft, needsConfirmation } = deriveFashionTemplate(reads, meta);
    expect(draft.fashion?.poseSequence[0]).toBe("front_stand");
    expect(draft.fashion?.poseSequence[1]).toBe("front_stand");
    expect(needsConfirmation.some((x) => x.includes("shot 1 pose"))).toBe(true);
    expect(needsConfirmation.some((x) => x.includes("shot 2 pose"))).toBe(true);
  });

  it("camera text matching findPresetByPrompt → crash_push", () => {
    expect(CRASH_PUSH_ZH).toBe("crash_push");
    const reads = [
      shot({
        index: 0,
        start: 0,
        end: 3,
        role: "hook",
        cameraText: "镜头急速推近主体，冲击力强，开场抓眼",
      }),
      shot({ index: 1, start: 3, end: 6, role: "cta", poseText: "正面" }),
    ];
    const { draft } = deriveFashionTemplate(reads, meta);
    expect(draft.cameraPlan.hook).toBe("crash_push");
  });

  it("camera 非整句描述仍写入 cameraPlan，不进需要确认", () => {
    const reads = [
      shot({
        index: 0,
        start: 0,
        end: 3,
        role: "hook",
        poseText: "正面站姿",
        cameraText: "镜头急速推近主体",
      }),
      shot({
        index: 1,
        start: 3,
        end: 6,
        role: "demo",
        poseText: "走向镜头",
        cameraText: "镜头跟随人物移动",
      }),
      shot({
        index: 2,
        start: 6,
        end: 9,
        role: "cta",
        poseText: "四分之三",
        cameraText: "微距缓慢滑移",
      }),
    ];
    const { draft, needsConfirmation } = deriveFashionTemplate(reads, meta);
    expect(draft.cameraPlan.hook).toBe("crash_push");
    expect(draft.cameraPlan.demo).toBe("follow_track");
    expect(draft.fashion?.poseSequence).toEqual(["front_stand", "walk_toward", "three_quarter"]);
    expect(needsConfirmation.filter((x) => x.includes("camera"))).toEqual([]);
    expect(needsConfirmation.filter((x) => x.includes("pose"))).toEqual([]);
  });

  it("¥ on-screen text → price_card payload is the category word, not the original copy", () => {
    const reads = [
      shot({
        index: 0,
        start: 0,
        end: 3,
        role: "hook",
        onScreenText: ["¥199"],
        hasSpeech: true,
        words: ["上新", "优惠"],
      }),
      shot({ index: 1, start: 3, end: 6, role: "cta", hasSpeech: true, words: ["下单"] }),
    ];
    const { draft } = deriveFashionTemplate(reads, meta);
    expect(draft.fashion?.scriptPattern).toBe("voiceover");
    const price = draft.fashion?.wordAnchors?.find((a) => a.element === "price_card");
    expect(price).toBeDefined();
    expect(price?.payload).toBe("价格卡");
    expect(price?.payload).not.toContain("¥");
    expect(price?.at).toEqual({ keyword: "上新" });
  });

  it("no speech → scriptPattern none and only sfx anchors remain", () => {
    const reads = [
      shot({ index: 0, start: 0, end: 3, role: "hook", onScreenText: ["¥299"], hasSpeech: false }),
      shot({ index: 1, start: 3, end: 6, role: "cta", hasSpeech: false }),
    ];
    const { draft } = deriveFashionTemplate(reads, meta);
    expect(draft.fashion?.scriptPattern).toBe("none");
    const anchors = draft.fashion?.wordAnchors ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((a) => a.element === "sfx")).toBe(true);
  });

  it("on-camera → lookSource grid + live_presenter", () => {
    const reads = [
      shot({ index: 0, start: 0, end: 3, role: "hook", onCamera: true, hasSpeech: true, words: ["今天"] }),
      shot({ index: 1, start: 3, end: 6, role: "cta", onCamera: true, hasSpeech: true }),
    ];
    const { draft } = deriveFashionTemplate(reads, meta);
    expect(draft.fashion?.lookSource).toBe("grid");
    expect(draft.fashion?.scriptPattern).toBe("on-camera");
    expect(draft.videoMode).toBe("live_presenter");
    expect(draft.group).toBe("presenter");
    expect(draft.styleType).toBe("talking_head");
  });

  it("derivedFrom is filled", () => {
    const { draft } = deriveFashionTemplate(threeShot, meta);
    expect(draft.fashion?.derivedFrom?.referenceId).toBe(meta.referenceId);
    expect(draft.fashion?.derivedFrom?.shotCount).toBe(3);
    expect(draft.fashion?.derivedFrom?.derivedAt).toMatch(/^\d{4}-/);
  });

  it("no transcript sentence appears in tagline / scriptHint", () => {
    const line = "这件连衣裙真的超级好穿亲们赶紧下单";
    const reads = [
      shot({
        index: 0,
        start: 0,
        end: 4,
        role: "hook",
        hasSpeech: true,
        words: line.split(""),
        onScreenText: [line],
      }),
      shot({ index: 1, start: 4, end: 8, role: "cta", hasSpeech: true, words: ["结尾口播完整句子不要出现"] }),
    ];
    const { draft } = deriveFashionTemplate(reads, meta);
    expect(draft.tagline.zh).not.toContain("连衣裙");
    expect(draft.tagline.en).not.toContain("连衣裙");
    expect(draft.scriptHint.zh).not.toContain("连衣裙");
    expect(draft.scriptHint.zh).not.toContain("赶紧下单");
    expect(draft.scriptHint.zh).not.toContain("结尾口播完整句子不要出现");
    const payloads = (draft.fashion?.wordAnchors ?? []).map((a) => a.payload ?? "").join(" ");
    expect(payloads).not.toContain("连衣裙");
    expect(payloads).not.toContain(line);
  });
});
