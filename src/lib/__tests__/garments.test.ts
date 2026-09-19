import { describe, expect, it } from "vitest";
import {
  isGarmentCategory,
  parseColorTags,
  pickByIds,
  storedPathToUrl,
  toGarmentDto,
  toGarmentSetDto,
  toIsoString,
  toLookDto,
} from "@/lib/garments";

describe("parseColorTags", () => {
  it("解析 JSON 数组字符串", () => {
    expect(parseColorTags('["navy", "cream"]')).toEqual(["navy", "cream"]);
  });

  it("解析逗号分隔字符串", () => {
    expect(parseColorTags("navy, cream, rust")).toEqual(["navy", "cream", "rust"]);
  });

  it("去重（大小写不敏感）并保留首次写法", () => {
    expect(parseColorTags(["Navy", "navy", "NAVY", "cream"])).toEqual(["Navy", "cream"]);
  });

  it("限制最多 12 个标签、每个最多 32 字符", () => {
    const many = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    expect(parseColorTags(many)).toHaveLength(12);
    const long = "x".repeat(40);
    expect(parseColorTags([long])[0]).toHaveLength(32);
  });

  it("忽略非字符串与空值", () => {
    expect(parseColorTags([1, null, undefined, "", "  ", "ok", { a: 1 }])).toEqual(["ok"]);
    expect(parseColorTags(null)).toEqual([]);
    expect(parseColorTags(42)).toEqual([]);
    expect(parseColorTags("")).toEqual([]);
  });
});

describe("isGarmentCategory", () => {
  it("只接受词表中的类目", () => {
    expect(isGarmentCategory("tops")).toBe(true);
    expect(isGarmentCategory("one-pieces")).toBe(true);
    expect(isGarmentCategory("hat")).toBe(false);
    expect(isGarmentCategory("Tops")).toBe(false);
    expect(isGarmentCategory(null)).toBe(false);
  });
});

describe("DTO 映射", () => {
  const created = new Date("2024-06-01T12:00:00.000Z");
  const updated = new Date("2024-06-02T12:00:00.000Z");

  it("toGarmentDto 把 frontPath/backPath 映射为 /api/files/garments/<file>", () => {
    const dto = toGarmentDto({
      id: "g1",
      name: "米白针织",
      category: "tops",
      view: "flat",
      frontPath: "garments/g1-front.png",
      backPath: "garments/g1-back.jpg",
      colorTags: ["cream"],
      notes: "麻花纹",
      createdAt: created,
      updatedAt: updated,
    });
    expect(dto.frontUrl).toBe("/api/files/garments/g1-front.png");
    expect(dto.backUrl).toBe("/api/files/garments/g1-back.jpg");
    expect(dto.createdAt).toBe("2024-06-01T12:00:00.000Z");
    expect(dto.updatedAt).toBe("2024-06-02T12:00:00.000Z");
    expect(dto.colorTags).toEqual(["cream"]);
    expect(dto.view).toBe("flat");
  });

  it("toGarmentSetDto 带上按 garmentIds 顺序解析后的 garments，缺 id 由 pickByIds 跳过", () => {
    const gA = toGarmentDto({
      id: "a",
      name: "A",
      category: "tops",
      view: "flat",
      frontPath: "garments/a-front.png",
      backPath: null,
      colorTags: [],
      notes: null,
      createdAt: created,
      updatedAt: created,
    });
    const gC = toGarmentDto({
      id: "c",
      name: "C",
      category: "bottoms",
      view: "on-model",
      frontPath: "garments/c-front.webp",
      backPath: null,
      colorTags: [],
      notes: null,
      createdAt: created,
      updatedAt: created,
    });
    const ordered = pickByIds(["c", "missing", "a"], [gA, gC]);
    expect(ordered.map((g) => g.id)).toEqual(["c", "a"]);
    const set = toGarmentSetDto(
      {
        id: "s1",
        name: "日常",
        garmentIds: ["c", "missing", "a"],
        characterId: null,
        createdAt: created,
        updatedAt: created,
      },
      ordered
    );
    expect(set.garments.map((g) => g.id)).toEqual(["c", "a"]);
    expect(set.garmentIds).toEqual(["c", "missing", "a"]);
  });

  it("toLookDto 把 imagePath 映射为 /api/files/looks/<setId>/<file>", () => {
    const dto = toLookDto({
      id: "l1",
      garmentSetId: "s1",
      characterId: "c1",
      characterSnapshot: { id: "c1", name: "小柔", referenceImages: [] },
      poseId: "front_stand",
      lookPresetId: null,
      route: "compose",
      provider: "fal-ai",
      model: "flux",
      imagePath: "looks/s1/l1.png",
      score: null,
      status: "candidate",
      error: null,
      createdAt: created,
      updatedAt: updated,
    });
    expect(dto.imageUrl).toBe("/api/files/looks/s1/l1.png");
    expect(dto.status).toBe("candidate");
    expect(dto.route).toBe("compose");
    expect(dto.characterSnapshot?.name).toBe("小柔");
  });

  it("storedPathToUrl 与 toIsoString 的边界", () => {
    expect(storedPathToUrl("/api/files/garments/x.png")).toBe("/api/files/garments/x.png");
    expect(storedPathToUrl("uploads/garments/x.png")).toBe("/api/files/garments/x.png");
    expect(storedPathToUrl(null)).toBeNull();
    expect(toIsoString(created)).toBe("2024-06-01T12:00:00.000Z");
    expect(toIsoString(1_717_243_200)).toBe("2024-06-01T12:00:00.000Z");
  });
});
