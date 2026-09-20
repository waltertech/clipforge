import { describe, it, expect } from "vitest";
import type { AdTemplate, FashionFields } from "@/lib/ad-templates";
import { MissingLooksError, type FashionLookInput } from "@/lib/fashion-shots";
import { mapAdTemplateStyleType, planFromLook } from "@/lib/from-look-plan";

const look = (poseId: string, imageUrl: string, status = "accepted"): FashionLookInput => ({
  poseId,
  imageUrl,
  status,
});

function fashionTpl(fashion?: Partial<FashionFields>, rest?: Partial<AdTemplate>): AdTemplate {
  return {
    id: "test_fashion",
    emoji: "x",
    name: { zh: "测试模板", en: "Test Template" },
    tagline: { zh: "测试卖点", en: "Test pitch" },
    group: "presenter",
    goodFor: ["fashion"],
    styleType: "scenario",
    videoMode: "live_presenter",
    look: "premium_gray",
    cameraPlan: { hook: "pull_reveal", demo: "follow_track", cta: "lateral_track" },
    compose: { captionPreset: "minimal", bgm: "energetic", bgmDuck: true },
    scriptHint: { zh: "测试提示" },
    kind: "fashion",
    ...rest,
    fashion: {
      poseSequence: ["front_stand", "walk_toward", "three_quarter", "back"],
      shotRoles: ["hook", "demo", "demo", "cta"],
      shotSeconds: [3, 4, 3, 3],
      lookSource: "accepted",
      lock: { face: true, garmentPattern: true, noOutfitChange: true },
      negative: { zh: "换衣服", en: "outfit swap" },
      scriptPattern: "none",
      ...fashion,
    },
  };
}

const FOUR_LOOKS: FashionLookInput[] = [
  look("front_stand", "https://look/front.jpg"),
  look("walk_toward", "https://look/walk.jpg"),
  look("three_quarter", "https://look/tq.jpg"),
  look("back", "https://look/back.jpg"),
];

const SET = {
  name: "夏日套装",
  garments: [
    { name: "白衬衫", frontUrl: "/api/files/garments/shirt.jpg" },
    { name: "西裤", frontUrl: "/api/files/garments/pants.jpg" },
  ],
};

const CHARACTER = {
  id: "char_1",
  name: "小美",
  appearance: "黑色长直发",
  referenceImages: ["https://sheet/1.jpg"],
};

describe("mapAdTemplateStyleType", () => {
  it("scenario → scene，pain-point → pain_point，枚举内原样，其余 custom", () => {
    expect(mapAdTemplateStyleType("scenario")).toBe("scene");
    expect(mapAdTemplateStyleType("pain-point")).toBe("pain_point");
    expect(mapAdTemplateStyleType("talking_head")).toBe("talking_head");
    expect(mapAdTemplateStyleType("product_pov")).toBe("product_pov");
    expect(mapAdTemplateStyleType("mystery-style")).toBe("custom");
    expect(mapAdTemplateStyleType("auto")).toBe("custom");
  });
});

describe("planFromLook", () => {
  it("4-pose 模板 → 4 shots，totalDuration 为各镜之和", () => {
    const plan = planFromLook({
      template: fashionTpl(),
      looks: FOUR_LOOKS,
      garmentSet: SET,
      character: CHARACTER,
    });
    expect(plan.shots).toHaveLength(4);
    expect(plan.shots.map((s) => s.shotId)).toEqual([1, 2, 3, 4]);
    expect(plan.scriptFields.shots).toHaveLength(4);
    expect(plan.scriptFields.totalDuration).toBe(13);
    expect(plan.keyframes[1]).toBe("https://look/front.jpg");
    expect(plan.keyframes[4]).toBe("https://look/back.jpg");
  });

  it("styleType 映射写入 scriptFields，projectFields.productImages 取服装正面图", () => {
    const scenario = planFromLook({
      template: fashionTpl(),
      looks: FOUR_LOOKS,
      garmentSet: SET,
      character: CHARACTER,
    });
    expect(scenario.scriptFields.styleType).toBe("scene");
    expect(scenario.projectFields.productCategory).toBe("fashion");
    expect(scenario.projectFields.productName).toBe("夏日套装");
    expect(scenario.projectFields.videoMode).toBe("live_presenter");
    expect(scenario.projectFields.productImages).toEqual([
      "/api/files/garments/shirt.jpg",
      "/api/files/garments/pants.jpg",
    ]);
    expect(scenario.projectFields.productDescription).toBe("白衬衫 · 西裤");
    expect(scenario.projectFields.name).toContain("夏日套装");
    expect(scenario.scriptFields.title).toBe("测试模板");
    expect(scenario.scriptFields.characters).toEqual([
      { id: "char_1", name: "小美", gender: "female", appearance: "黑色长直发" },
    ]);

    const talking = planFromLook({
      template: fashionTpl(undefined, { styleType: "talking_head" }),
      looks: FOUR_LOOKS,
      garmentSet: SET,
      character: CHARACTER,
    });
    expect(talking.scriptFields.styleType).toBe("talking_head");

    const pain = planFromLook({
      template: fashionTpl(undefined, { styleType: "pain-point" }),
      looks: FOUR_LOOKS,
      garmentSet: SET,
      character: CHARACTER,
    });
    expect(pain.scriptFields.styleType).toBe("pain_point");
  });

  it("缺 accepted Look 时透传 MissingLooksError", () => {
    expect(() =>
      planFromLook({
        template: fashionTpl(),
        looks: [look("front_stand", "https://look/front.jpg")],
        garmentSet: SET,
        character: CHARACTER,
      })
    ).toThrow(MissingLooksError);
    try {
      planFromLook({
        template: fashionTpl(),
        looks: [look("front_stand", "https://look/front.jpg")],
        garmentSet: SET,
        character: CHARACTER,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(MissingLooksError);
      expect((err as MissingLooksError).missingPoses).toEqual(["walk_toward", "three_quarter", "back"]);
    }
  });

  it("跳过空 frontUrl，characterId 写入每镜", () => {
    const plan = planFromLook({
      template: fashionTpl(),
      looks: FOUR_LOOKS,
      garmentSet: {
        name: "空图套装",
        garments: [
          { name: "A", frontUrl: "/api/files/a.jpg" },
          { name: "B", frontUrl: "" },
        ],
      },
      character: CHARACTER,
      lang: "en",
    });
    expect(plan.projectFields.productImages).toEqual(["/api/files/a.jpg"]);
    expect(plan.shots.every((s) => s.characterId === "char_1")).toBe(true);
    expect(plan.scriptFields.title).toBe("Test Template");
  });
});
