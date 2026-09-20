/**
 * Vision-LLM reader: look at per-shot frames (+ timing + ASR words) and emit a
 * structured ReferenceShotRead. One request for ≤5 shots, otherwise batches of 3.
 * Structure only — never asked to transcribe copy for reuse in the template.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import type OpenAI from "openai";
import {
  defaultFashionShotRoles,
  FASHION_MAX_SHOTS,
} from "@/lib/ad-templates";
import type { Shot } from "@/lib/db/schema";
import { createLLMClient, jsonModeParams, withLLMErrors } from "@/lib/llm-error";
import { extractJSON } from "@/lib/script-engine/generator";
import type { LLMConfig } from "@/lib/script-engine/generator";
import type { ReferenceJob, ReferenceShotRead } from "@/lib/reference/types";

const SHOT_ROLES = new Set<Shot["type"]>([
  "hook",
  "pain_point",
  "product_reveal",
  "demo",
  "social_proof",
  "cta",
]);
const FRAMINGS = new Set<ReferenceShotRead["framing"]>(["full", "half", "detail", "other"]);
const CAPTIONS = new Set<NonNullable<ReferenceShotRead["captionStyle"]>>([
  "bold",
  "standard",
  "karaoke",
  "minimal",
  "none",
]);

export interface ReaderShotMeta {
  index: number;
  start: number;
  end: number;
  words?: string[];
  frameCount?: number;
}

export function buildReaderPrompt(shotMeta: ReaderShotMeta[], locale: "zh" | "en"): string {
  const lang = locale === "en" ? "English" : "简体中文";
  const listing = shotMeta
    .map((s) => {
      const words = s.words?.length ? s.words.slice(0, 12).join(" ") : "(none)";
      return `shot ${s.index}: ${s.start.toFixed(2)}s–${s.end.toFixed(2)}s, ${s.frameCount ?? 3} frames, spoken words (timing only, do not copy): ${words}`;
    })
    .join("\n");
  return [
    `You are a fashion-commercial video analyst. Inspect the supplied frames (first/middle/last of each shot) and return ONLY JSON.`,
    `Write free-text values in ${lang}. Extract STRUCTURE (pose, camera move, shot role, caption look) — never quote on-screen copy or spoken lines for reuse.`,
    `Shots:`,
    listing,
    `JSON schema: { "shots": [ { "index": 0, "role": "hook|pain_point|product_reveal|demo|social_proof|cta", "framing": "full|half|detail|other", "poseText": "short pose description", "poseId": "optional pose-preset id if sure", "poseConfidence": 0.0, "cameraText": "camera move description", "captionStyle": "bold|standard|karaoke|minimal|none", "onScreenText": ["visible words, for classification only"], "hasSpeech": false, "onCamera": false } ] }`,
    `Return exactly ${shotMeta.length} objects in shots, ordered by index. poseConfidence is 0–1.`,
  ].join("\n");
}

function asString(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asBool(v: unknown): boolean {
  return v === true;
}

function asStringList(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 80))
    .slice(0, max);
}

function defaultShot(index: number, shotCount: number): Partial<ReferenceShotRead> {
  const roles = defaultFashionShotRoles(Math.max(1, shotCount));
  return {
    index,
    role: roles[index] ?? "demo",
    framing: "other",
    poseText: "",
    poseConfidence: 0,
    cameraText: "",
    onScreenText: [],
    hasSpeech: false,
    onCamera: false,
    frames: [],
  };
}

function normalizeShot(raw: unknown, index: number, shotCount: number): Partial<ReferenceShotRead> {
  const base = defaultShot(index, shotCount);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const role = SHOT_ROLES.has(r.role as Shot["type"]) ? (r.role as Shot["type"]) : base.role;
  const framing = FRAMINGS.has(r.framing as ReferenceShotRead["framing"])
    ? (r.framing as ReferenceShotRead["framing"])
    : base.framing;
  const captionStyle = CAPTIONS.has(r.captionStyle as NonNullable<ReferenceShotRead["captionStyle"]>)
    ? (r.captionStyle as ReferenceShotRead["captionStyle"])
    : undefined;
  let poseConfidence = typeof r.poseConfidence === "number" && Number.isFinite(r.poseConfidence) ? r.poseConfidence : 0;
  poseConfidence = Math.min(1, Math.max(0, poseConfidence));
  const poseId = asString(r.poseId, 40) || undefined;
  return {
    ...base,
    index,
    role,
    framing,
    poseText: asString(r.poseText, 200),
    ...(poseId && { poseId }),
    poseConfidence,
    cameraText: asString(r.cameraText, 200),
    ...(typeof r.cameraPresetId === "string" && r.cameraPresetId.trim() && { cameraPresetId: r.cameraPresetId.trim().slice(0, 40) }),
    ...(captionStyle && { captionStyle }),
    onScreenText: asStringList(r.onScreenText),
    hasSpeech: asBool(r.hasSpeech),
    onCamera: asBool(r.onCamera),
  };
}

/**
 * Tolerant parser: markdown fences, missing fields → defaults, wrong length → pad/trim + lowConfidence.
 * Never throws.
 */
export function parseReaderOutput(
  raw: string,
  shotCount: number,
): { shots: Partial<ReferenceShotRead>[]; lowConfidence: boolean } {
  const n = Math.max(0, Math.min(FASHION_MAX_SHOTS, Math.floor(shotCount) || 0));
  let lowConfidence = false;
  let arr: unknown[] = [];
  try {
    const json = extractJSON(raw || "");
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { shots?: unknown }).shots)) {
      arr = (parsed as { shots: unknown[] }).shots;
    } else {
      lowConfidence = true;
    }
  } catch {
    lowConfidence = true;
  }
  if (arr.length !== n) lowConfidence = true;
  const shots: Partial<ReferenceShotRead>[] = [];
  for (let i = 0; i < n; i++) shots.push(normalizeShot(arr[i], i, n));
  return { shots, lowConfidence };
}

async function fileToDataUrl(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ReadReferenceInput {
  job: ReferenceJob;
  /** Relative frame file names per shot (aligned with job.shots) */
  frames: string[][];
  transcript?: { words: Array<{ w: string; s: number; e: number }> } | null;
  locale: "zh" | "en";
  config: LLMConfig;
  /** Absolute directory containing the frame files */
  framesDir: string;
}

async function callVision(
  config: LLMConfig,
  prompt: string,
  dataUrls: string[],
): Promise<string> {
  const model = config.visionModel || config.model;
  const client = createLLMClient({ ...config, model });
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...dataUrls.map(
      (url): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url, detail: "low" },
      }),
    ),
  ];
  const response = await withLLMErrors(
    () =>
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content }],
        temperature: 0.2,
        max_tokens: 3500,
        ...jsonModeParams(config.baseUrl),
      }),
    { ...config, model },
  );
  return response.choices[0]?.message?.content || "";
}

function wordsForShot(
  transcript: ReadReferenceInput["transcript"],
  start: number,
  end: number,
): string[] {
  if (!transcript?.words?.length) return [];
  return transcript.words.filter((w) => w.s < end && w.e > start && w.w.trim()).map((w) => w.w.trim());
}

/**
 * Fill per-shot structure from the vision model. Returns partial reads aligned with job.shots
 * plus a lowConfidence flag (malformed / wrong-length JSON in any batch).
 */
export async function readReference(
  input: ReadReferenceInput,
): Promise<{ shots: Partial<ReferenceShotRead>[]; lowConfidence: boolean }> {
  const jobShots = input.job.shots ?? [];
  const n = jobShots.length;
  if (n === 0) return { shots: [], lowConfidence: false };

  const metas: ReaderShotMeta[] = jobShots.map((s, i) => ({
    index: i,
    start: s.start,
    end: s.end,
    words: s.words?.length ? s.words : wordsForShot(input.transcript, s.start, s.end),
    frameCount: (input.frames[i] ?? s.frames ?? []).length,
  }));

  const dataUrlsPerShot: string[][] = [];
  for (let i = 0; i < n; i++) {
    const names = input.frames[i] ?? jobShots[i].frames ?? [];
    const urls: string[] = [];
    for (const name of names) {
      const abs = join(input.framesDir, name.split(/[\\/]/).pop() || name);
      try {
        urls.push(await fileToDataUrl(abs));
      } catch {
        /* skip unreadable frames */
      }
    }
    dataUrlsPerShot.push(urls);
  }

  const batchSize = n > 5 ? 3 : n;
  const batches = chunk(
    metas.map((m, i) => ({ meta: m, urls: dataUrlsPerShot[i], index: i })),
    batchSize,
  );

  const merged: Partial<ReferenceShotRead>[] = Array.from({ length: n }, (_, i) => ({ index: i }));
  let lowConfidence = false;

  for (const batch of batches) {
    const prompt = buildReaderPrompt(
      batch.map((b) => b.meta),
      input.locale,
    );
    const urls = batch.flatMap((b) => b.urls);
    const raw = await callVision(input.config, prompt, urls);
    const parsed = parseReaderOutput(raw, batch.length);
    if (parsed.lowConfidence) lowConfidence = true;
    for (let k = 0; k < batch.length; k++) {
      merged[batch[k].index] = { ...parsed.shots[k], index: batch[k].index };
    }
  }

  return { shots: merged, lowConfidence };
}
