/**
 * Vision-LLM quality score for one Look still.
 *
 * Axes are 0–5 integers (higher is better, including `artifact`). `overall` is a
 * weighted blend, or null when the model output could not be parsed at all.
 */
import type OpenAI from "openai";
import { createLLMClient, jsonModeParams, withLLMErrors } from "@/lib/llm-error";
import { toRemoteUsableImage } from "@/lib/remote-image";
import type { LLMConfig } from "@/lib/script-engine/generator";
import type { LookScore } from "./types";

export type { LLMConfig };

export const LOOK_SCORE_WEIGHTS = {
  garment: 0.4,
  identity: 0.25,
  pose: 0.2,
  artifact: 0.15,
} as const;

const AXES = ["garment", "pose", "identity", "artifact"] as const;
type Axis = (typeof AXES)[number];

export interface ScoreLookInput {
  lookImageUrl: string;
  modelRefUrl?: string;
  garmentUrls: string[];
  poseDescription: string;
  garmentNotes?: string;
  locale: "zh" | "en";
  config: LLMConfig;
}

/** Weighted overall, rounded to one decimal. */
export function overallLookScore(s: Pick<LookScore, "garment" | "pose" | "identity" | "artifact">): number {
  const raw =
    s.garment * LOOK_SCORE_WEIGHTS.garment +
    s.identity * LOOK_SCORE_WEIGHTS.identity +
    s.pose * LOOK_SCORE_WEIGHTS.pose +
    s.artifact * LOOK_SCORE_WEIGHTS.artifact;
  return Math.round(raw * 10) / 10;
}

/** Ask for a strict four-axis JSON object. Language follows `locale`. */
export function buildLookScorePrompt(input: Pick<ScoreLookInput, "poseDescription" | "garmentNotes" | "locale">): string {
  const notes = input.garmentNotes?.trim();
  if (input.locale === "en") {
    return [
      "You are scoring one fashion Look photograph. Compare the Look image (first picture) against the model identity reference and the garment references that follow.",
      `Target pose: ${input.poseDescription}`,
      notes ? `Garment notes to preserve: ${notes}` : "",
      "Score each axis as an integer 0–5 (higher is better):",
      "- garment: colour, pattern, print placement, fabric and cut match the garment references.",
      "- pose: the body matches the target pose description.",
      "- identity: face, hair and body match the model reference (same person).",
      "- artifact: freedom from extra limbs, warped seams, text, watermarks, collage borders.",
      "Return ONLY one JSON object, no markdown, no prose:",
      '{"garment":0,"pose":0,"identity":0,"artifact":0,"reasons":["short evidence"]}',
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "你在为一张时装 Look 照片打分。第一张图是 Look 成品，后面依次是模特定妆参考和服装参考。",
    `目标姿态：${input.poseDescription}`,
    notes ? `需要保留的服装说明：${notes}` : "",
    "四个轴均为 0–5 的整数，越高越好：",
    "- garment：颜色、图案、印花位置、面料与版型是否与服装参考一致。",
    "- pose：身体姿态是否符合目标姿态描述。",
    "- identity：脸、发型、体型是否与模特参考为同一人。",
    "- artifact：有无多余肢体、扭曲接缝、文字、水印、拼贴边框（越高越干净）。",
    "只返回一个 JSON 对象，不要 markdown，不要其它文字：",
    '{"garment":0,"pose":0,"identity":0,"artifact":0,"reasons":["简短依据"]}',
  ]
    .filter(Boolean)
    .join("\n");
}

function extractFirstObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  const end = body.lastIndexOf("}");
  return end > start ? body.slice(start, end + 1) : null;
}

function clampAxis(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(5, n)));
}

function unparsable(evaluatorModel?: string): LookScore {
  return {
    garment: 0,
    pose: 0,
    identity: 0,
    artifact: 0,
    overall: null,
    reasons: ["unparsable"],
    ...(evaluatorModel ? { evaluatorModel } : {}),
  };
}

/**
 * Tolerant parser: strips fences, takes the first `{...}`, clamps axes to [0, 5] ints.
 * Missing axis → 0 + a reason. Non-JSON → overall null with reason "unparsable".
 */
export function parseLookScore(raw: string, evaluatorModel?: string): LookScore {
  const extracted = extractFirstObject(raw);
  if (!extracted) return unparsable(evaluatorModel);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    return unparsable(evaluatorModel);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return unparsable(evaluatorModel);
  }
  const obj = parsed as Record<string, unknown>;
  const reasons: string[] = [];
  const scores = {} as Record<Axis, number>;
  for (const axis of AXES) {
    if (!(axis in obj) || obj[axis] == null) {
      scores[axis] = 0;
      reasons.push(`missing ${axis}`);
      continue;
    }
    const clamped = clampAxis(obj[axis]);
    if (clamped == null) {
      scores[axis] = 0;
      reasons.push(`missing ${axis}`);
    } else {
      scores[axis] = clamped;
    }
  }
  if (Array.isArray(obj.reasons)) {
    for (const item of obj.reasons) {
      if (typeof item === "string" && item.trim()) reasons.push(item.trim());
    }
  }
  return {
    garment: scores.garment,
    pose: scores.pose,
    identity: scores.identity,
    artifact: scores.artifact,
    overall: overallLookScore(scores),
    reasons,
    ...(evaluatorModel ? { evaluatorModel } : {}),
  };
}

async function remote(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  return (await toRemoteUsableImage(url)) ?? url;
}

/** Score one Look. Callers must not let a throw fail the Look row itself. */
export async function scoreLook(input: ScoreLookInput): Promise<LookScore> {
  const model = input.config.visionModel || input.config.model;
  const lookUrl = await remote(input.lookImageUrl);
  if (!lookUrl) {
    return unparsable(model);
  }
  const modelRef = await remote(input.modelRefUrl);
  const garments = (await Promise.all(input.garmentUrls.map((u) => remote(u)))).filter(
    (u): u is string => Boolean(u)
  );

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: buildLookScorePrompt(input) },
    { type: "image_url", image_url: { url: lookUrl, detail: "high" } },
  ];
  if (modelRef) {
    content.push({ type: "image_url", image_url: { url: modelRef, detail: "low" } });
  }
  for (const url of garments) {
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
  }

  const client = createLLMClient({ ...input.config, model });
  const response = await withLLMErrors(
    () =>
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content }],
        temperature: 0.1,
        max_tokens: 800,
        ...jsonModeParams(input.config.baseUrl),
      }),
    { ...input.config, model }
  );
  return parseLookScore(response.choices[0]?.message?.content || "", model);
}
