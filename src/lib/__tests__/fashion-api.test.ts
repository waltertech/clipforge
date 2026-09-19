import { describe, expect, it } from "vitest";
import {
  buildGarmentsQuery,
  formatColorTagsInput,
  groupLooksByPoseId,
  hasConfiguredImageProvider,
  isLookInFlight,
  lookScoreTone,
  matchesLookFilter,
  moveItem,
  parseColorTags,
  validateGarmentImage,
  GARMENT_MAX_IMAGE_BYTES,
  type Look,
} from "@/lib/fashion-api";

function look(partial: Partial<Look> & Pick<Look, "id" | "poseId" | "status">): Look {
  return {
    garmentSetId: "set-1",
    characterId: "char-1",
    characterSnapshot: null,
    lookPresetId: null,
    route: "compose",
    provider: null,
    model: null,
    imageUrl: null,
    score: null,
    error: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("parseColorTags", () => {
  it("splits on comma and Chinese comma, trims, and drops empties", () => {
    expect(parseColorTags(" black,  ivory， ")).toEqual(["black", "ivory"]);
  });

  it("dedupes case-insensitively and keeps the first spelling", () => {
    expect(parseColorTags("Navy, navy, NAVY")).toEqual(["Navy"]);
  });

  it("returns [] for blank input", () => {
    expect(parseColorTags("  , ， ")).toEqual([]);
  });
});

describe("formatColorTagsInput", () => {
  it("joins with comma-space for the edit field", () => {
    expect(formatColorTagsInput(["black", "ivory"])).toBe("black, ivory");
  });
});

describe("validateGarmentImage", () => {
  it("accepts jpeg/png/webp under 20 MB", () => {
    expect(validateGarmentImage({ type: "image/jpeg", size: 1024 })).toBe("ok");
    expect(validateGarmentImage({ type: "image/png", size: 1 })).toBe("ok");
    expect(validateGarmentImage({ type: "image/webp", size: GARMENT_MAX_IMAGE_BYTES })).toBe("ok");
  });

  it("falls back to the file extension when MIME is empty", () => {
    expect(validateGarmentImage({ type: "", size: 10, name: "coat.PNG" })).toBe("ok");
    expect(validateGarmentImage({ type: "", size: 10, name: "coat.gif" })).toBe("type");
  });

  it("rejects other types and oversized files", () => {
    expect(validateGarmentImage({ type: "image/gif", size: 10 })).toBe("type");
    expect(validateGarmentImage({ type: "image/jpeg", size: GARMENT_MAX_IMAGE_BYTES + 1 })).toBe("size");
  });
});

describe("moveItem", () => {
  it("swaps with the neighbour and no-ops at the edges", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("look helpers", () => {
  it("treats pending/generating as in-flight", () => {
    expect(isLookInFlight("pending")).toBe(true);
    expect(isLookInFlight("generating")).toBe(true);
    expect(isLookInFlight("candidate")).toBe(false);
    expect(isLookInFlight("failed")).toBe(false);
  });

  it("colours overall scores: ≥4 green, 3–4 amber, <3 red", () => {
    expect(lookScoreTone(5)).toBe("green");
    expect(lookScoreTone(4)).toBe("green");
    expect(lookScoreTone(3.9)).toBe("amber");
    expect(lookScoreTone(3)).toBe("amber");
    expect(lookScoreTone(2.9)).toBe("red");
    expect(lookScoreTone(null)).toBe(null);
    expect(lookScoreTone(undefined)).toBe(null);
  });

  it("filters looks by status bucket", () => {
    const rows = [
      look({ id: "a", poseId: "front_stand", status: "accepted" }),
      look({ id: "c", poseId: "front_stand", status: "candidate" }),
      look({ id: "p", poseId: "side", status: "pending" }),
      look({ id: "f", poseId: "back", status: "failed" }),
      look({ id: "r", poseId: "back", status: "rejected" }),
    ];
    expect(rows.filter((row) => matchesLookFilter(row, "all")).map((row) => row.id)).toEqual(["a", "c", "p", "f", "r"]);
    expect(rows.filter((row) => matchesLookFilter(row, "accepted")).map((row) => row.id)).toEqual(["a"]);
    expect(rows.filter((row) => matchesLookFilter(row, "candidates")).map((row) => row.id)).toEqual(["c", "p"]);
    expect(rows.filter((row) => matchesLookFilter(row, "failed")).map((row) => row.id)).toEqual(["f"]);
  });

  it("groups by pose, known presets first then leftovers", () => {
    const grouped = groupLooksByPoseId([
      look({ id: "1", poseId: "back", status: "candidate" }),
      look({ id: "2", poseId: "front_stand", status: "candidate" }),
      look({ id: "3", poseId: "custom_x", status: "failed" }),
    ]);
    expect(grouped.map((g) => g.poseId)).toEqual(["front_stand", "back", "custom_x"]);
    expect(grouped[0].looks.map((l) => l.id)).toEqual(["2"]);
  });
});

describe("buildGarmentsQuery", () => {
  it("omits all/blank filters", () => {
    expect(buildGarmentsQuery({})).toBe("");
    expect(buildGarmentsQuery({ category: "all", q: "  " })).toBe("");
  });

  it("encodes category and q", () => {
    expect(buildGarmentsQuery({ category: "tops", q: "coat" })).toBe("?category=tops&q=coat");
  });
});

describe("hasConfiguredImageProvider", () => {
  it("requires an enabled provider with a key AND a default image model", () => {
    expect(hasConfiguredImageProvider({ "fal-ai": { enabled: true, apiKey: "k" } }, "flux")).toBe(true);
    expect(hasConfiguredImageProvider({ "fal-ai": { enabled: true, apiKey: "k" } }, "")).toBe(false);
    expect(hasConfiguredImageProvider({ "fal-ai": { enabled: false, apiKey: "k" } }, "flux")).toBe(false);
    expect(hasConfiguredImageProvider({ "fal-ai": { enabled: true, apiKey: "" } }, "flux")).toBe(false);
  });
});
