import { describe, expect, it } from "vitest";
import { buildLookScorePrompt, overallLookScore, parseLookScore } from "@/lib/tryon/score";

const complete = {
  garment: 4,
  pose: 5,
  identity: 3,
  artifact: 4,
  reasons: ["print holds", "pose matches"],
};

describe("parseLookScore", () => {
  it("parses fenced JSON into four axes plus overall", () => {
    const raw = `\`\`\`json\n${JSON.stringify(complete)}\n\`\`\``;
    const score = parseLookScore(raw, "gpt-4o");
    expect(score.garment).toBe(4);
    expect(score.pose).toBe(5);
    expect(score.identity).toBe(3);
    expect(score.artifact).toBe(4);
    expect(score.overall).toBe(overallLookScore(score));
    expect(score.reasons).toEqual(expect.arrayContaining(["print holds", "pose matches"]));
    expect(score.evaluatorModel).toBe("gpt-4o");
  });

  it("finds the first object when prose wraps the JSON", () => {
    const raw = `Here is the score:\n${JSON.stringify(complete)}\nThanks.`;
    const score = parseLookScore(raw);
    expect(score.garment).toBe(4);
    expect(score.pose).toBe(5);
    expect(score.overall).not.toBeNull();
  });

  it("missing axis becomes 0 with a reason", () => {
    const score = parseLookScore(JSON.stringify({ garment: 4, pose: 4, artifact: 4, reasons: [] }));
    expect(score.identity).toBe(0);
    expect(score.reasons.some((r) => /identity/i.test(r))).toBe(true);
    expect(score.overall).toBe(overallLookScore(score));
  });

  it("clamps out-of-range axes (7→5, -1→0)", () => {
    const score = parseLookScore(JSON.stringify({ garment: 7, pose: -1, identity: 2, artifact: 9 }));
    expect(score.garment).toBe(5);
    expect(score.pose).toBe(0);
    expect(score.identity).toBe(2);
    expect(score.artifact).toBe(5);
  });

  it("non-JSON → overall null with reason unparsable", () => {
    const score = parseLookScore("the look is pretty good overall");
    expect(score.overall).toBeNull();
    expect(score.reasons).toContain("unparsable");
    expect(score.garment).toBe(0);
  });
});

describe("overallLookScore", () => {
  it("weights garment 0.4, identity 0.25, pose 0.2, artifact 0.15 and rounds to 1 decimal", () => {
    expect(overallLookScore({ garment: 5, pose: 5, identity: 5, artifact: 5 })).toBe(5);
    expect(overallLookScore({ garment: 5, pose: 0, identity: 0, artifact: 0 })).toBe(2);
    // 5*0.4 + 4*0.25 + 3*0.2 + 2*0.15 = 2 + 1 + 0.6 + 0.3 = 3.9
    expect(overallLookScore({ garment: 5, pose: 3, identity: 4, artifact: 2 })).toBe(3.9);
  });
});

describe("buildLookScorePrompt", () => {
  it("mentions all four axes and a JSON-only instruction", () => {
    const prompt = buildLookScorePrompt({
      poseDescription: "front-facing full-body stance",
      garmentNotes: "keep the floral print",
      locale: "en",
    });
    expect(prompt).toMatch(/garment/i);
    expect(prompt).toMatch(/pose/i);
    expect(prompt).toMatch(/identity/i);
    expect(prompt).toMatch(/artifact/i);
    expect(prompt).toMatch(/JSON/i);
    expect(prompt).toMatch(/only/i);
    expect(prompt).toContain("front-facing full-body stance");
    expect(prompt).toContain("floral print");
  });
});
