import { describe, it, expect } from "vitest";
import { buildLookPrompt, lookReferenceImages, pickLookLang } from "@/lib/tryon/prompt";
import type { LookRequest } from "@/lib/tryon/types";
import { getPosePreset } from "@/lib/pose-presets";
import { REAL_FACE_CONSTRAINT } from "@/lib/presenters";

const pose = getPosePreset("three_quarter")!;

function req(overrides: Partial<LookRequest> = {}): LookRequest {
  return {
    modelRefs: ["https://x/sheet.png"],
    modelAppearance: "32 岁左右居家女性，低马尾",
    garments: [{ url: "https://x/top.jpg", category: "tops", view: "flat", notes: "米白针织，保留麻花纹" }],
    pose,
    aspect: "3:4",
    lock: { face: true, garmentPattern: true },
    ...overrides,
  };
}

describe("Look 提示词", () => {
  it("参考图顺序 = 模特图 → 服装正面 → 服装背面", () => {
    const r = req({
      modelRefs: ["m1", "m2"],
      garments: [
        { url: "g1", category: "tops", view: "flat", backUrl: "g1b" },
        { url: "g2", category: "bottoms", view: "on-model" },
      ],
    });
    expect(lookReferenceImages(r)).toEqual(["m1", "m2", "g1", "g2", "g1b"]);
    const p = buildLookPrompt(r);
    expect(p).toContain("第 1–2 张参考图是模特");
    expect(p).toContain("第 3 张参考图是平铺商品图：上装");
    expect(p).toContain("第 4 张参考图是上身参考图：下装");
    expect(p).toContain("第 5 张参考图是该上装的背面");
  });

  it("语言：CJK 文本走中文，纯英文走英文，显式 lang 优先", () => {
    expect(pickLookLang(req())).toBe("zh");
    const en = req({ modelAppearance: "a woman in her thirties", garments: [{ url: "g", category: "tops", view: "flat", notes: "cream knit" }] });
    expect(pickLookLang(en)).toBe("en");
    expect(buildLookPrompt(en)).toContain("Reference image 1 is the model");
    expect(pickLookLang({ ...en, lang: "zh" })).toBe("zh");
    expect(pickLookLang(req({ modelAppearance: undefined, garments: [{ url: "g", category: "tops", view: "flat" }] }))).toBe("zh");
  });

  it("含真人约束、姿态描述与无文字/边框硬规则", () => {
    const p = buildLookPrompt(req());
    expect(p).toContain(REAL_FACE_CONSTRAINT.zh);
    expect(p).toContain(pose.prompt.zh);
    expect(p).toMatch(/不出现任何文字/);
    expect(p).toContain("保留麻花纹");
  });

  it("锁定项控制对应句子", () => {
    const locked = buildLookPrompt(req());
    expect(locked).toMatch(/颜色、图案、印花位置.*完全一致/);
    expect(locked).toMatch(/脸型、五官、发型.*完全一致/);
    const free = buildLookPrompt(req({ lock: { face: false, garmentPattern: false } }));
    expect(free).not.toMatch(/颜色、图案、印花位置/);
    expect(free).not.toMatch(/脸型、五官、发型/);
  });

  it("叠穿按内到外标注层次", () => {
    const p = buildLookPrompt(
      req({
        garments: [
          { url: "a", category: "tops", view: "flat" },
          { url: "b", category: "bottoms", view: "flat" },
          { url: "c", category: "outerwear", view: "flat" },
        ],
      })
    );
    expect(p).toContain("第 1 层，最内");
    expect(p).toContain("第 2 层，中间");
    expect(p).toContain("第 3 层，最外");
  });

  it("look 预设被追加，缺省用中性影棚光", () => {
    expect(buildLookPrompt(req({ lookPresetId: "daylight_clean" }))).toContain("窗边日光");
    expect(buildLookPrompt(req())).toContain("柔和均匀的影棚光");
    expect(buildLookPrompt(req({ lookPresetId: "not_a_preset" }))).toContain("柔和均匀的影棚光");
  });

  it("无模特参考图时用人物设定作为身份锚", () => {
    const p = buildLookPrompt(req({ modelRefs: [] }));
    expect(p).not.toContain("张参考图是模特");
    expect(p).toContain("人物设定：32 岁左右居家女性");
    expect(p).toContain("第 1 张参考图是平铺商品图");
    expect(p).toMatch(/与人物设定完全一致/);
  });
});
