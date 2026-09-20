import { describe, it, expect } from "vitest";
import { parseReaderOutput, buildReaderPrompt } from "@/lib/reference/reader";

describe("parseReaderOutput", () => {
  it("parses fenced JSON object with shots[]", () => {
    const raw = `\`\`\`json
{"shots":[
  {"index":0,"role":"hook","framing":"full","poseText":"正面站","poseConfidence":0.9,"cameraText":"推近","captionStyle":"bold","onScreenText":["SALE"],"hasSpeech":true,"onCamera":true},
  {"index":1,"role":"cta","framing":"half","poseText":"侧身","poseConfidence":0.7,"cameraText":"环绕","onScreenText":[],"hasSpeech":false,"onCamera":false}
]}
\`\`\``;
    const { shots, lowConfidence } = parseReaderOutput(raw, 2);
    expect(lowConfidence).toBe(false);
    expect(shots).toHaveLength(2);
    expect(shots[0].role).toBe("hook");
    expect(shots[0].framing).toBe("full");
    expect(shots[0].poseText).toBe("正面站");
    expect(shots[0].poseConfidence).toBe(0.9);
    expect(shots[0].onCamera).toBe(true);
    expect(shots[0].onScreenText).toEqual(["SALE"]);
    expect(shots[1].role).toBe("cta");
    expect(shots[1].hasSpeech).toBe(false);
  });

  it("fills defaults for missing fields without throwing", () => {
    const { shots, lowConfidence } = parseReaderOutput('[{"role":"demo"}]', 1);
    expect(lowConfidence).toBe(false);
    expect(shots[0].poseText).toBe("");
    expect(shots[0].poseConfidence).toBe(0);
    expect(shots[0].onScreenText).toEqual([]);
    expect(shots[0].hasSpeech).toBe(false);
    expect(shots[0].onCamera).toBe(false);
    expect(shots[0].framing).toBe("other");
    expect(shots[0].role).toBe("demo");
  });

  it("wrong length → pad/trim + lowConfidence", () => {
    const padded = parseReaderOutput('[{"role":"hook","poseText":"a"}]', 3);
    expect(padded.lowConfidence).toBe(true);
    expect(padded.shots).toHaveLength(3);
    expect(padded.shots[0].poseText).toBe("a");
    expect(padded.shots[2].poseText).toBe("");
    expect(padded.shots[2].role).toBe("cta"); // defaultFashionShotRoles(3) last is cta

    const trimmed = parseReaderOutput(JSON.stringify([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]), 2);
    expect(trimmed.lowConfidence).toBe(true);
    expect(trimmed.shots).toHaveLength(2);
  });

  it("malformed JSON does not throw and flags lowConfidence", () => {
    const { shots, lowConfidence } = parseReaderOutput("not json at all {{{", 2);
    expect(lowConfidence).toBe(true);
    expect(shots).toHaveLength(2);
    expect(shots[0].index).toBe(0);
  });
});

describe("buildReaderPrompt", () => {
  it("lists shot timing and asks for JSON", () => {
    const p = buildReaderPrompt([{ index: 0, start: 0, end: 3, words: ["hello"] }], "zh");
    expect(p).toContain("shot 0");
    expect(p).toContain("hello");
    expect(p).toMatch(/JSON/i);
  });
});
