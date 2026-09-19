import { describe, it, expect } from "vitest";
import {
  AD_TEMPLATES,
  defaultFashionShotRoles,
  defaultFashionShotSeconds,
  type AdTemplate,
  type FashionFields,
} from "@/lib/ad-templates";
import { getCameraPreset } from "@/lib/camera-presets";
import { getPosePreset } from "@/lib/pose-presets";
import {
  buildFashionShots,
  missingPosesFor,
  MissingLooksError,
  type FashionLookInput,
} from "@/lib/fashion-shots";

const look = (poseId: string, imageUrl: string, status = "accepted"): FashionLookInput => ({
  poseId,
  imageUrl,
  status,
});

function fashionTpl(fashion?: Partial<FashionFields>, rest?: Partial<AdTemplate>): AdTemplate {
  return {
    id: "test_fashion",
    emoji: "👗",
    name: { zh: "测试", en: "Test" },
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

describe("buildFashionShots", () => {
  it("4 pose → 4 shots，shotId 从 1 起，固定 visualSource/transition/voiceover", () => {
    const { shots } = buildFashionShots(fashionTpl(), FOUR_LOOKS);
    expect(shots).toHaveLength(4);
    expect(shots.map((s) => s.shotId)).toEqual([1, 2, 3, 4]);
    for (const s of shots) {
      expect(s.visualSource).toBe("user_upload");
      expect(s.transition).toBe("direct_concat");
      expect(s.voiceover).toBe("");
      expect(s.prompt).toBeUndefined();
    }
  });

  it("type 按 shotRoles；缺省时首镜 hook、末镜 cta、中间 demo", () => {
    const withRoles = buildFashionShots(fashionTpl(), FOUR_LOOKS);
    expect(withRoles.shots.map((s) => s.type)).toEqual(["hook", "demo", "demo", "cta"]);

    const defaults = buildFashionShots(
      fashionTpl({ shotRoles: undefined, poseSequence: ["front_stand", "side", "back", "walk_toward"] }),
      [
        look("front_stand", "a"),
        look("side", "b"),
        look("back", "c"),
        look("walk_toward", "d"),
      ]
    );
    expect(defaults.shots.map((s) => s.type)).toEqual(defaultFashionShotRoles(4));
    expect(defaults.shots.map((s) => s.type)).toEqual(["hook", "demo", "demo", "cta"]);
  });

  it("keyframes 指向该姿态的 accepted Look；candidate 不算", () => {
    const looks = [
      look("front_stand", "https://old/front.jpg", "candidate"),
      look("front_stand", "https://look/front.jpg"),
      look("walk_toward", "https://look/walk.jpg"),
      look("three_quarter", "https://look/tq.jpg", "rejected"),
      look("three_quarter", "https://look/tq-ok.jpg"),
      look("back", "https://look/back.jpg"),
    ];
    const { keyframes } = buildFashionShots(fashionTpl(), looks);
    expect(keyframes[1]).toBe("https://look/front.jpg");
    expect(keyframes[2]).toBe("https://look/walk.jpg");
    expect(keyframes[3]).toBe("https://look/tq-ok.jpg");
    expect(keyframes[4]).toBe("https://look/back.jpg");
  });

  it("同一 pose 出现两次时复用同一张 accepted Look", () => {
    const tpl = fashionTpl({
      poseSequence: ["front_stand", "side", "back", "front_stand"],
      shotSeconds: [3, 3, 3, 3],
    });
    const looks = [
      look("front_stand", "https://look/front.jpg"),
      look("side", "https://look/side.jpg"),
      look("back", "https://look/back.jpg"),
    ];
    const { shots, keyframes } = buildFashionShots(tpl, looks);
    expect(shots).toHaveLength(4);
    expect(keyframes[1]).toBe("https://look/front.jpg");
    expect(keyframes[4]).toBe("https://look/front.jpg");
    expect(keyframes[1]).toBe(keyframes[4]);
  });

  it("缺 accepted Look 时抛 MissingLooksError，缺失 pose 按序列去重排序", () => {
    const tpl = fashionTpl({
      poseSequence: ["front_stand", "side", "back", "front_stand"],
      shotSeconds: [3, 3, 3, 3],
    });
    const looks = [look("back", "https://look/back.jpg"), look("side", "https://look/side.jpg", "candidate")];
    expect(missingPosesFor(tpl, looks)).toEqual(["front_stand", "side"]);
    try {
      buildFashionShots(tpl, looks);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingLooksError);
      expect((err as MissingLooksError).missingPoses).toEqual(["front_stand", "side"]);
    }
  });

  it("非时装模板抛普通 Error，不静默跳过", () => {
    const ad = AD_TEMPLATES[0];
    expect(ad.kind).not.toBe("fashion");
    try {
      buildFashionShots(ad, FOUR_LOOKS);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(MissingLooksError);
    }
  });

  it("camera 优先 cameraPlan，否则 pose.suggestedCamera[0]，再否则空串", () => {
    const planned = buildFashionShots(fashionTpl(), FOUR_LOOKS);
    expect(planned.shots[0].camera).toBe(getCameraPreset("pull_reveal")!.prompt.zh);
    expect(planned.shots[1].camera).toBe(getCameraPreset("follow_track")!.prompt.zh);
    expect(planned.shots[3].camera).toBe(getCameraPreset("lateral_track")!.prompt.zh);

    const suggestedPose = "walk_toward";
    const suggested = buildFashionShots(
      fashionTpl(
        { poseSequence: ["walk_toward"], shotRoles: ["demo"], shotSeconds: [3] },
        { cameraPlan: { hook: "crash_push", cta: "slow_push" } }
      ),
      [look("walk_toward", "https://look/walk.jpg")]
    );
    expect(suggested.shots[0].camera).toBe(
      getCameraPreset(getPosePreset(suggestedPose)!.suggestedCamera![0])!.prompt.zh
    );

    const empty = buildFashionShots(
      fashionTpl(
        { poseSequence: ["not_a_pose"], shotRoles: ["demo"], shotSeconds: [3], lookSource: "grid" },
        { cameraPlan: { hook: "crash_push", cta: "slow_push" } }
      ),
      []
    );
    expect(empty.shots[0].camera).toBe("");
  });

  it("lookSource=grid 时不抛、keyframes 为空（九宫格稍后渲染首帧）", () => {
    const tpl = fashionTpl({ lookSource: "grid" });
    const { shots, keyframes } = buildFashionShots(tpl, []);
    expect(shots).toHaveLength(4);
    expect(keyframes).toEqual({});
  });

  it("时长取 shotSeconds；缺省按 totalSeconds 均分", () => {
    const explicit = buildFashionShots(fashionTpl(), FOUR_LOOKS);
    expect(explicit.shots.map((s) => s.duration)).toEqual([3, 4, 3, 3]);

    const split = buildFashionShots(fashionTpl({ shotSeconds: undefined }), FOUR_LOOKS);
    expect(split.shots.map((s) => s.duration)).toEqual(defaultFashionShotSeconds(4, 12));
    expect(split.shots.map((s) => s.duration)).toEqual([3, 3, 3, 3]);

    const customTotal = buildFashionShots(fashionTpl({ shotSeconds: undefined }), FOUR_LOOKS, {
      totalSeconds: 16,
    });
    expect(customTotal.shots.map((s) => s.duration)).toEqual(defaultFashionShotSeconds(4, 16));
  });

  it("lang=en 时 description 与 camera 为英文", () => {
    const { shots } = buildFashionShots(fashionTpl(), FOUR_LOOKS, {
      lang: "en",
      garmentSetName: "Summer Set",
      characterId: "char_1",
    });
    const front = getPosePreset("front_stand")!;
    expect(shots[0].description).toBe(`${front.name.en}：${front.prompt.en}, wearing "Summer Set"`);
    expect(shots[0].camera).toBe(getCameraPreset("pull_reveal")!.prompt.en);
    expect(shots[0].characterId).toBe("char_1");
    expect(shots[0].description).not.toMatch(/[一-鿿]/);
  });

  it("默认中文 description 含姿态名与 prompt，可拼服装组名", () => {
    const { shots } = buildFashionShots(fashionTpl(), FOUR_LOOKS, { garmentSetName: "夏日套装" });
    const front = getPosePreset("front_stand")!;
    expect(shots[0].description).toBe(`${front.name.zh}：${front.prompt.zh}，穿着「夏日套装」`);
  });
});
