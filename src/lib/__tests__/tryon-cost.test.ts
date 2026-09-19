import { describe, expect, it } from "vitest";
import { estimateLookCost } from "@/lib/tryon/cost";

describe("estimateLookCost", () => {
  it("compose: one image call per pose, no try-on", () => {
    const cost = estimateLookCost({ route: "compose", poses: 3, garments: 2, scoring: false });
    expect(cost.calls).toEqual({ image: 3, tryon: 0, vision: 0 });
    expect(cost.note.zh).toContain("3 次生图");
    expect(cost.note.en).toMatch(/3 image/);
  });

  it("vton: try-on = poses × garments", () => {
    const cost = estimateLookCost({ route: "vton", poses: 3, garments: 2, scoring: false });
    expect(cost.calls).toEqual({ image: 0, tryon: 6, vision: 0 });
    expect(cost.note.zh).toContain("6 次 FASHN");
  });

  it("scoring adds one vision call per pose", () => {
    const compose = estimateLookCost({ route: "compose", poses: 4, garments: 1, scoring: true });
    expect(compose.calls).toEqual({ image: 4, tryon: 0, vision: 4 });
    const vton = estimateLookCost({ route: "vton", poses: 2, garments: 3, scoring: true });
    expect(vton.calls).toEqual({ image: 0, tryon: 6, vision: 2 });
  });

  it("zero poses is a zero-call estimate", () => {
    const cost = estimateLookCost({ route: "compose", poses: 0, garments: 5, scoring: true });
    expect(cost.calls).toEqual({ image: 0, tryon: 0, vision: 0 });
  });
});
