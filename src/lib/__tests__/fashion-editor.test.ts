import { describe, it, expect } from "vitest";
import { FASHION_MAX_SHOTS, getAdTemplate, type FashionFields, type WordAnchor } from "@/lib/ad-templates";
import {
  addPose,
  fashionIssues,
  movePose,
  removePose,
  removeWordAnchor,
  toggleLock,
  upsertWordAnchor,
} from "@/lib/fashion-editor";

function sample(): FashionFields {
  return {
    poseSequence: ["front_stand", "side", "back", "front_stand"],
    shotRoles: ["hook", "demo", "demo", "cta"],
    shotSeconds: [3, 4, 5, 6],
    lookSource: "accepted",
    lock: { face: true, garmentPattern: true, noOutfitChange: true },
    negative: { zh: "换衣服", en: "outfit swap" },
    scriptPattern: "on-camera",
    wordAnchors: [
      { shot: 0, at: "first", element: "sfx", payload: "a" },
      { shot: 2, at: "last", element: "price_card", payload: "b" },
      { shot: 3, at: "first", element: "sfx", payload: "c" },
    ],
  };
}

describe("movePose", () => {
  it("keeps roles/seconds aligned and remaps anchors", () => {
    const f = movePose(sample(), 0, 2);
    expect(f.poseSequence).toEqual(["side", "back", "front_stand", "front_stand"]);
    expect(f.shotRoles).toEqual(["demo", "demo", "hook", "cta"]);
    expect(f.shotSeconds).toEqual([4, 5, 3, 6]);
    expect(f.wordAnchors?.map((a) => a.shot)).toEqual([2, 1, 3]);
    expect(f.wordAnchors?.map((a) => a.payload)).toEqual(["a", "b", "c"]);
  });
});

describe("removePose", () => {
  it("drops that shot's anchors and shifts later ones", () => {
    const f = removePose(sample(), 2);
    expect(f.poseSequence).toEqual(["front_stand", "side", "front_stand"]);
    expect(f.shotRoles).toEqual(["hook", "demo", "cta"]);
    expect(f.shotSeconds).toEqual([3, 4, 6]);
    expect(f.wordAnchors).toEqual([
      { shot: 0, at: "first", element: "sfx", payload: "a" },
      { shot: 2, at: "first", element: "sfx", payload: "c" },
    ]);
  });
});

describe("addPose", () => {
  it("respects FASHION_MAX_SHOTS", () => {
    const full: FashionFields = {
      ...sample(),
      poseSequence: Array.from({ length: FASHION_MAX_SHOTS }, () => "side"),
      shotRoles: Array.from({ length: FASHION_MAX_SHOTS }, () => "demo"),
      shotSeconds: Array.from({ length: FASHION_MAX_SHOTS }, () => 3),
      wordAnchors: [],
    };
    const blocked = addPose(full, "front_stand");
    expect(blocked.poseSequence).toHaveLength(FASHION_MAX_SHOTS);
    expect(blocked.poseSequence).toEqual(full.poseSequence);

    const grown = addPose(sample(), "walk_toward");
    expect(grown.poseSequence).toEqual(["front_stand", "side", "back", "front_stand", "walk_toward"]);
    expect(grown.shotRoles).toHaveLength(5);
    expect(grown.shotSeconds).toHaveLength(5);
  });
});

describe("toggleLock", () => {
  it("flips a single lock flag and leaves the others", () => {
    const off = toggleLock(sample(), "face");
    expect(off.lock).toEqual({ face: false, garmentPattern: true, noOutfitChange: true });
    const on = toggleLock(off, "face");
    expect(on.lock.face).toBe(true);
    const pattern = toggleLock(sample(), "garmentPattern");
    expect(pattern.lock.garmentPattern).toBe(false);
    expect(pattern.lock.face).toBe(true);
  });
});

describe("upsertWordAnchor / removeWordAnchor", () => {
  it("appends, replaces at index, and removes", () => {
    const added = upsertWordAnchor(sample(), {
      shot: 1,
      at: "last",
      element: "brand_tag",
      payload: "x",
    });
    expect(added.wordAnchors).toHaveLength(4);
    expect(added.wordAnchors?.[3]).toEqual({
      shot: 1,
      at: "last",
      element: "brand_tag",
      payload: "x",
    } satisfies WordAnchor);

    const replaced = upsertWordAnchor(
      added,
      { shot: 1, at: "last", element: "brand_tag", payload: "y" },
      3,
    );
    expect(replaced.wordAnchors?.[3].payload).toBe("y");
    expect(replaced.wordAnchors).toHaveLength(4);

    const removed = removeWordAnchor(replaced, 3);
    expect(removed.wordAnchors).toHaveLength(3);
    expect(removed.wordAnchors?.some((a) => a.payload === "y")).toBe(false);
  });
});

describe("fashionIssues", () => {
  it("returns [] for the builtin mirror_turn fields", () => {
    const tpl = getAdTemplate("mirror_turn");
    expect(tpl?.fashion).toBeDefined();
    expect(fashionIssues(tpl!.fashion!)).toEqual([]);
  });
});
