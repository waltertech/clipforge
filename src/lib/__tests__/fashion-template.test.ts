import { describe, it, expect } from "vitest";
import {
  sanitizeFashionFields,
  sanitizeCustomAdTemplate,
  isFashionTemplate,
  defaultFashionShotRoles,
  defaultFashionShotSeconds,
  exportAdTemplateShare,
  parseAdTemplateShare,
  parseAdTemplateShareAny,
  listAdTemplates,
  AD_TEMPLATE_SHARE_KIND,
  AD_TEMPLATE_PACK_KIND,
  AD_TEMPLATES,
  type AdTemplate,
} from "@/lib/ad-templates";
import { DEFAULT_POSE_SEQUENCE } from "@/lib/pose-presets";

const validFashion = {
  poseSequence: ["front_stand", "side", "back", "front_stand"],
  shotRoles: ["hook", "demo", "demo", "cta"],
  shotSeconds: [3, 3, 3, 3],
  lookSource: "accepted",
  garmentCategories: ["tops", "one-pieces"],
  lock: { face: true, garmentPattern: true, noOutfitChange: true },
  negative: { zh: "换衣服、换脸", en: "outfit swap, face change" },
  scriptPattern: "on-camera",
  wordAnchors: [
    { shot: 1, at: { keyword: "价格" }, element: "price_card", payload: "¥199", seconds: 2 },
    { shot: 3, at: "first", element: "sfx", payload: "whoosh" },
  ],
  slots: { model: true, garmentSet: true, hook: false },
  derivedFrom: { referenceId: "ref_1", derivedAt: "2026-09-19T00:00:00Z", shotCount: 4 },
};

const baseTemplate = {
  kind: "fashion",
  emoji: "👗",
  name: { zh: "镜前转身", en: "Mirror Turn" },
  tagline: { zh: "四个角度一次看全", en: "Four angles in one turn" },
  group: "presenter",
  styleType: "scenario",
  videoMode: "live_presenter",
  look: "selfie_front",
  cameraPlan: { hook: "slow_push", demo: "body_orbit", cta: "push_then_hold" },
  compose: { captionPreset: "minimal", bgm: "chill", bgmDuck: true },
  scriptHint: { zh: "无台词，靠转身与 BGM 节奏" },
  fashion: validFashion,
};

describe("sanitizeFashionFields", () => {
  it("合法样例原样通过，无 issues", () => {
    const { fields, issues } = sanitizeFashionFields(validFashion);
    expect(issues).toEqual([]);
    expect(fields.poseSequence).toEqual(validFashion.poseSequence);
    expect(fields.shotRoles).toEqual(validFashion.shotRoles);
    expect(fields.shotSeconds).toEqual([3, 3, 3, 3]);
    expect(fields.wordAnchors).toHaveLength(2);
    expect(fields.derivedFrom?.referenceId).toBe("ref_1");
    expect(fields.slots).toEqual({ model: true, garmentSet: true, hook: false });
  });

  it("未知 pose id 被丢弃并记录；全部未知时回落默认序列", () => {
    const r = sanitizeFashionFields({ ...validFashion, poseSequence: ["front_stand", "moonwalk"] });
    expect(r.fields.poseSequence).toEqual(["front_stand"]);
    expect(r.issues.some((i) => i.includes("moonwalk"))).toBe(true);
    const empty = sanitizeFashionFields({ ...validFashion, poseSequence: ["x", "y"] });
    expect(empty.fields.poseSequence).toEqual([...DEFAULT_POSE_SEQUENCE]);
  });

  it("超过 9 镜截断", () => {
    const r = sanitizeFashionFields({ ...validFashion, poseSequence: Array(12).fill("side"), shotRoles: undefined, shotSeconds: undefined, wordAnchors: undefined });
    expect(r.fields.poseSequence).toHaveLength(9);
    expect(r.issues.some((i) => i.includes("truncated"))).toBe(true);
  });

  it("shotRoles / shotSeconds 长度不匹配则丢弃", () => {
    const r = sanitizeFashionFields({ ...validFashion, shotRoles: ["hook"], shotSeconds: [3, 3] });
    expect(r.fields.shotRoles).toBeUndefined();
    expect(r.fields.shotSeconds).toBeUndefined();
    expect(r.issues.filter((i) => i.includes("dropped")).length).toBeGreaterThanOrEqual(2);
  });

  it("shotSeconds 钳制到 2–15；总和超 60 丢弃", () => {
    const clamped = sanitizeFashionFields({ ...validFashion, shotSeconds: [1, 20, 3.26, 3] });
    expect(clamped.fields.shotSeconds).toEqual([2, 15, 3.5, 3]);
    const over = sanitizeFashionFields({
      ...validFashion,
      poseSequence: ["side", "side", "side", "side", "side"],
      shotRoles: undefined,
      wordAnchors: undefined,
      shotSeconds: [15, 15, 15, 15, 5],
    });
    expect(over.fields.shotSeconds).toBeUndefined();
    expect(over.issues.some((i) => i.includes("exceeds"))).toBe(true);
  });

  it("lock / negative / scriptPattern / lookSource 缺失或非法时取默认并记录", () => {
    const r = sanitizeFashionFields({ poseSequence: ["side"] });
    expect(r.fields.lock).toEqual({ face: true, garmentPattern: true, noOutfitChange: true });
    expect(r.fields.negative.zh.length).toBeGreaterThan(0);
    expect(r.fields.negative.en.length).toBeGreaterThan(0);
    expect(r.fields.scriptPattern).toBe("none");
    expect(r.fields.lookSource).toBe("accepted");
    expect(r.issues.length).toBeGreaterThan(0);
    const bad = sanitizeFashionFields({ ...validFashion, lookSource: "magic", scriptPattern: "sing" });
    expect(bad.fields.lookSource).toBe("accepted");
    expect(bad.fields.scriptPattern).toBe("none");
  });

  it("wordAnchors：越界镜号、未知元素、空关键词丢弃；none 模式只留 sfx", () => {
    const r = sanitizeFashionFields({
      ...validFashion,
      wordAnchors: [
        { shot: 9, at: "first", element: "sfx" },
        { shot: 0, at: "first", element: "confetti" },
        { shot: 0, at: { keyword: "   " }, element: "price_card" },
        { shot: 0, at: "last", element: "brand_tag", payload: "x".repeat(100) },
      ],
    });
    expect(r.fields.wordAnchors).toHaveLength(1);
    expect(r.fields.wordAnchors![0].payload).toHaveLength(60);

    const none = sanitizeFashionFields({
      ...validFashion,
      scriptPattern: "none",
      wordAnchors: [
        { shot: 0, at: "first", element: "price_card", payload: "¥1" },
        { shot: 0, at: "first", element: "sfx", payload: "ding" },
      ],
    });
    expect(none.fields.wordAnchors).toEqual([{ shot: 0, at: "first", element: "sfx", payload: "ding" }]);
  });

  it("garmentCategories 去重并丢弃未知", () => {
    const r = sanitizeFashionFields({ ...validFashion, garmentCategories: ["tops", "tops", "hats"] });
    expect(r.fields.garmentCategories).toEqual(["tops"]);
  });

  it("默认镜头角色与时长", () => {
    expect(defaultFashionShotRoles(1)).toEqual(["hook"]);
    expect(defaultFashionShotRoles(4)).toEqual(["hook", "demo", "demo", "cta"]);
    expect(defaultFashionShotSeconds(4, 12)).toEqual([3, 3, 3, 3]);
    expect(defaultFashionShotSeconds(9, 12).every((s) => s >= 2)).toBe(true);
  });
});

describe("sanitizeCustomAdTemplate 的 fashion 分支", () => {
  it("kind=fashion 时保留并清洗 fashion 字段", () => {
    const t = sanitizeCustomAdTemplate(baseTemplate)!;
    expect(isFashionTemplate(t)).toBe(true);
    expect(t.kind).toBe("fashion");
    expect(t.fashion?.poseSequence).toEqual(validFashion.poseSequence);
    expect(t.look).toBe("selfie_front");
  });

  it("kind 缺省或 ad 时丢弃 fashion 块", () => {
    const stray = sanitizeCustomAdTemplate({ ...baseTemplate, kind: undefined })!;
    expect(stray.kind).toBeUndefined();
    expect(stray.fashion).toBeUndefined();
    expect(isFashionTemplate(stray)).toBe(false);
    const ad = sanitizeCustomAdTemplate({ ...baseTemplate, kind: "ad" })!;
    expect(ad.fashion).toBeUndefined();
  });

  it("kind=fashion 但 fashion 缺失时仍生成默认配方", () => {
    const t = sanitizeCustomAdTemplate({ ...baseTemplate, fashion: undefined })!;
    expect(isFashionTemplate(t)).toBe(true);
    expect(t.fashion?.poseSequence).toEqual([...DEFAULT_POSE_SEQUENCE]);
  });
});

describe("share v2 与 v1 兼容", () => {
  it("fashion 模板导出/导入往返一致", () => {
    const t = sanitizeCustomAdTemplate(baseTemplate)!;
    const doc = JSON.parse(exportAdTemplateShare(t));
    expect(doc.version).toBe(2);
    expect(doc.template.kind).toBe("fashion");
    const back = parseAdTemplateShare(JSON.stringify(doc));
    expect(back.error).toBeUndefined();
    expect(back.template?.fashion).toEqual(t.fashion);
  });

  it("v1 文档仍可解析并视为 ad", () => {
    const v1 = { kind: AD_TEMPLATE_SHARE_KIND, version: 1, template: { ...AD_TEMPLATES[0], id: undefined } };
    const r = parseAdTemplateShare(JSON.stringify(v1));
    expect(r.error).toBeUndefined();
    expect(r.template?.kind).toBeUndefined();
    const pack = parseAdTemplateShareAny(JSON.stringify({ kind: AD_TEMPLATE_PACK_KIND, version: 1, templates: [AD_TEMPLATES[0], baseTemplate] }));
    expect(pack.templates).toHaveLength(2);
    expect(pack.templates![1].kind).toBe("fashion");
  });

  it("词锚点文案参与合规筛查", () => {
    const risky = {
      ...baseTemplate,
      fashion: { ...validFashion, wordAnchors: [{ shot: 0, at: "first", element: "price_card", payload: "全网最低价" }] },
    };
    const r = parseAdTemplateShare(JSON.stringify({ kind: AD_TEMPLATE_SHARE_KIND, version: 2, template: risky }));
    expect(r.template).toBeTruthy();
    expect(r.warnings?.length ?? 0).toBeGreaterThan(0);
  });

  it("listAdTemplates 可按 kind 过滤；现有库无 fashion 时返回空", () => {
    const ads = listAdTemplates({ kind: "ad" });
    expect(ads.length).toBe(AD_TEMPLATES.filter((t) => (t.kind ?? "ad") === "ad").length);
    const fashion = listAdTemplates({ kind: "fashion" });
    expect(fashion.every((t: AdTemplate) => t.kind === "fashion")).toBe(true);
  });
});
