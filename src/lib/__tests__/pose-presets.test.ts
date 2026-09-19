import { describe, it, expect } from "vitest";
import {
  POSE_PRESETS,
  DEFAULT_POSE_SEQUENCE,
  GARMENT_CATEGORIES,
  getPosePreset,
  isPoseId,
  listPosesFor,
} from "@/lib/pose-presets";
import { getCameraPreset } from "@/lib/camera-presets";

describe("姿态预设库", () => {
  it("id 唯一且非空", () => {
    const ids = POSE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z_]+$/.test(id))).toBe(true);
  });

  it("每个预设 zh/en 名称与提示词齐全，画幅与构图合法", () => {
    for (const p of POSE_PRESETS) {
      expect(p.name.zh.length, p.id).toBeGreaterThan(0);
      expect(p.name.en.length, p.id).toBeGreaterThan(0);
      expect(p.prompt.zh.length, p.id).toBeGreaterThan(10);
      expect(p.prompt.en.length, p.id).toBeGreaterThan(10);
      expect(["3:4", "9:16"]).toContain(p.aspect);
      expect(["full", "half", "detail"]).toContain(p.framing);
    }
  });

  it("suggestedCamera 与 excludeCategories 只引用真实词表", () => {
    for (const p of POSE_PRESETS) {
      for (const cam of p.suggestedCamera ?? []) expect(getCameraPreset(cam), `${p.id} → ${cam}`).toBeTruthy();
      for (const c of p.excludeCategories ?? []) expect(GARMENT_CATEGORIES).toContain(c);
    }
  });

  it("getPosePreset / isPoseId 对未知 id 返回 undefined / false", () => {
    expect(getPosePreset("front_stand")?.id).toBe("front_stand");
    expect(getPosePreset("nope")).toBeUndefined();
    expect(getPosePreset(undefined)).toBeUndefined();
    expect(isPoseId("side")).toBe(true);
    expect(isPoseId("Side")).toBe(false);
    expect(isPoseId(42)).toBe(false);
  });

  it("listPosesFor 按服装类目排除不适合的姿态", () => {
    const all = listPosesFor();
    expect(all.length).toBe(POSE_PRESETS.length);
    const forShoes = listPosesFor(["shoes"]).map((p) => p.id);
    expect(forShoes).not.toContain("detail_torso");
    expect(forShoes).not.toContain("hands_pocket");
    expect(forShoes).toContain("front_stand");
    const forOnePiece = listPosesFor(["one-pieces"]).map((p) => p.id);
    expect(forOnePiece).toContain("detail_torso");
  });

  it("默认姿态序列全部存在", () => {
    expect(DEFAULT_POSE_SEQUENCE.length).toBeGreaterThan(0);
    for (const id of DEFAULT_POSE_SEQUENCE) expect(isPoseId(id)).toBe(true);
  });
});
