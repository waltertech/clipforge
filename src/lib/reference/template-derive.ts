/**
 * Map a per-shot reference read into a Fashion AdTemplate draft (structure only).
 * Never copies transcript sentences or on-screen copy into tagline / scriptHint;
 * wordAnchor payloads are category labels ("价格卡"), not the original text.
 */
import {
  CUSTOM_AD_TEMPLATE_ID,
  defaultFashionShotRoles,
  sanitizeCustomAdTemplate,
  sanitizeFashionFields,
  type AdTemplate,
  type FashionFields,
  type WordAnchor,
  type WordAnchorElement,
} from "@/lib/ad-templates";
import { CAMERA_PRESETS, findPresetByPrompt, getCameraPreset } from "@/lib/camera-presets";
import { isCaptionPreset, type CaptionPresetId } from "@/lib/caption-presets";
import { getPosePreset, POSE_PRESETS } from "@/lib/pose-presets";
import type { Shot } from "@/lib/db/schema";
import type { ReferenceShotRead } from "@/lib/reference/types";

const FASHION_NEGATIVE = {
  zh: "服装变色、图案变化、换衣服、换脸、发型变化、多手指、文字水印",
  en: "garment colour shift, pattern change, outfit swap, face change, hairstyle change, extra fingers, text or watermark",
} as const;

const SHOT_ROLES = new Set<Shot["type"]>([
  "hook",
  "pain_point",
  "product_reveal",
  "demo",
  "social_proof",
  "cta",
]);

/** Per-pose keyword lists (zh + en). More specific poses are listed first. */
const POSE_KEYWORDS: Array<{ id: string; keywords: string[] }> = [
  { id: "detail_torso", keywords: ["细节", "特写", "面料", "detail", "close-up", "close up", "torso", "macro"] },
  { id: "hands_pocket", keywords: ["插兜", "插兔", "插袋", "口袋", "pocket"] },
  { id: "walk_toward", keywords: ["走向", "走来", "迈步", "步伐", "walk toward", "walk towards", "walking", "stride"] },
  { id: "seated", keywords: ["坐姿", "坐下", "seated", "sitting", "sit", "seat"] },
  { id: "three_quarter", keywords: ["四分之三", "three-quarter", "three quarter", "3/4"] },
  { id: "side", keywords: ["侧面", "侧身", "profile", "side profile"] },
  { id: "back", keywords: ["背面", "背对", "后背", "back view", "facing away"] },
  { id: "front_stand", keywords: ["正面", "front stand", "front-facing", "站姿"] },
];

export function matchPoseId(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  // Don't use isPoseId() as a type predicate here: its `id is string` signature would
  // narrow a string to `never` on the false branch (TS exclusive predicates).
  if (getPosePreset(t)) return t;
  const lower = t.toLowerCase();
  for (const p of POSE_PRESETS) {
    if (t.includes(p.name.zh) || lower.includes(p.name.en.toLowerCase())) return p.id;
  }
  for (const rule of POSE_KEYWORDS) {
    if (rule.keywords.some((k) => (/[a-z]/i.test(k) ? lower.includes(k.toLowerCase()) : t.includes(k)))) {
      return rule.id;
    }
  }
  // short tokens listed in the spec; avoid matching 步 inside 漫步 etc.
  if (t === "走" || t === "步" || /\bwalk\b/i.test(t)) return "walk_toward";
  if (/\bfront\b/i.test(t)) return "front_stand";
  if (/\bside\b/i.test(t)) return "side";
  if (/\bback\b/i.test(t)) return "back";
  return undefined;
}

/**
 * Vision-LLM camera text → CAMERA_PRESETS id.
 * findPresetByPrompt is exact-sentence only (UI "is a preset applied?"); readers
 * almost never quote the full preset, so we also match names and distinctive keywords.
 */
const CAMERA_KEYWORDS: Array<{ id: string; keywords: string[] }> = [
  { id: "crash_push", keywords: ["急速推近", "冲击力强", "crash in", "crash push"] },
  { id: "dolly_zoom", keywords: ["希区柯克", "dolly zoom"] },
  { id: "push_then_hold", keywords: ["推近后", "定住", "then hold", "稳定收尾"] },
  { id: "macro_glide", keywords: ["微距", "滑移", "macro glide", "macro close-up"] },
  { id: "follow_track", keywords: ["跟随人物", "跟随主体", "跟随镜头", "follow track", "follows the subject"] },
  { id: "orbit_slow", keywords: ["环绕半圈", "环绕展示", "slow orbit"] },
  { id: "body_orbit", keywords: ["贴身环走", "环走"] },
  { id: "lazy_susan", keywords: ["转台", "turntable"] },
  { id: "arc_quarter", keywords: ["弧形环移", "quarter circle"] },
  { id: "lateral_track", keywords: ["横移", "lateral track"] },
  { id: "whip_pan", keywords: ["甩镜", "whip pan"] },
  { id: "crane_up", keywords: ["升镜", "cranes up"] },
  { id: "crane_down_close", keywords: ["降镜", "cranes down"] },
  { id: "overhead_top", keywords: ["俯拍下降", "top-down", "overhead"] },
  { id: "handheld_real", keywords: ["手持实拍", "handheld sway"] },
  { id: "pov_walk", keywords: ["第一视角", "第一人称", "pov walk"] },
  { id: "hero_rise", keywords: ["英雄仰拍", "仰拍", "hero shot"] },
  { id: "locked_on", keywords: ["LOCKED-ON", "锁定跟拍"] },
  { id: "fpv_dive", keywords: ["FPV", "俯冲"] },
  { id: "focus_shift", keywords: ["焦点转移", "rack focus"] },
  { id: "pull_reveal", keywords: ["拉远", "pull back", "pulls back"] },
  { id: "slow_push", keywords: ["缓慢推近", "缓慢平稳", "slow push"] },
  { id: "follow_track", keywords: ["跟随", "follow"] },
];

export function matchCameraId(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const exact = findPresetByPrompt(t);
  if (exact) return exact.id;
  if (getCameraPreset(t)) return t;

  const lower = t.toLowerCase();
  for (const p of CAMERA_PRESETS) {
    if (t.includes(p.name.zh) || lower.includes(p.name.en.toLowerCase())) return p.id;
  }
  for (const rule of CAMERA_KEYWORDS) {
    if (rule.keywords.some((k) => (/[a-z]/i.test(k) ? lower.includes(k.toLowerCase()) : t.includes(k)))) {
      return rule.id;
    }
  }
  if (t.length >= 6) {
    const hits = CAMERA_PRESETS.filter(
      (p) => p.prompt.zh.includes(t) || p.prompt.en.toLowerCase().includes(lower),
    );
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) {
      hits.sort((a, b) => a.prompt.zh.length - b.prompt.zh.length);
      return hits[0].id;
    }
  }
  return undefined;
}

export function classifyOnScreenText(text: string): WordAnchorElement {
  if (/[¥￥$]|价|元|price/i.test(text)) return "price_card";
  const trimmed = text.trim();
  if (/^[A-Z][A-Z0-9]{0,11}$/.test(trimmed)) return "brand_tag";
  return "selling_point";
}

function payloadFor(element: WordAnchorElement): string {
  switch (element) {
    case "price_card":
      return "价格卡";
    case "brand_tag":
      return "品牌标";
    case "sfx":
      return "whoosh_soft";
    case "caption_emphasis":
      return "强调";
    default:
      return "卖点";
  }
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function clampSeconds(n: number): number {
  return Math.min(15, Math.max(2, roundHalf(n)));
}

function majorityCaption(shots: ReferenceShotRead[]): CaptionPresetId {
  const counts = new Map<CaptionPresetId, number>();
  for (const s of shots) {
    const raw = s.captionStyle === "none" || !s.captionStyle ? "minimal" : s.captionStyle;
    if (!isCaptionPreset(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  let best: CaptionPresetId = "minimal";
  let n = -1;
  for (const [id, c] of counts) {
    if (c > n) {
      best = id;
      n = c;
    }
  }
  return best;
}

function firstWord(shot: ReferenceShotRead): string | undefined {
  const w = shot.words?.find((x) => x.trim());
  return w?.trim().slice(0, 20) || undefined;
}

export interface DeriveMeta {
  referenceId: string;
  durationSec: number;
  hasTranscript: boolean;
  locale: "zh" | "en";
}

export function deriveFashionTemplate(
  read: ReferenceShotRead[],
  meta: DeriveMeta,
): { draft: AdTemplate; needsConfirmation: string[] } {
  const needsConfirmation: string[] = [];
  const shots = read.slice(0, 9);
  const n = Math.max(1, shots.length);

  const poseSequence: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const fromId = s.poseId && getPosePreset(s.poseId) ? s.poseId : undefined;
    const matched = fromId ?? matchPoseId(s.poseText || "");
    const conf = Number.isFinite(s.poseConfidence) ? s.poseConfidence : 0;
    if (!matched || conf < 0.5) {
      poseSequence.push("front_stand");
      needsConfirmation.push(`shot ${i + 1} pose`);
    } else {
      poseSequence.push(matched);
    }
  }
  if (poseSequence.length === 0) poseSequence.push("front_stand");

  const rolesIn = shots.map((s) => (SHOT_ROLES.has(s.role) ? s.role : undefined));
  const roles = defaultFashionShotRoles(n);
  for (let i = 0; i < n; i++) {
    if (rolesIn[i]) roles[i] = rolesIn[i]!;
  }
  if (n > 0) roles[0] = "hook";
  if (n > 1) roles[n - 1] = "cta";

  let shotSeconds = shots.map((s) => clampSeconds(Math.max(0.5, (s.end ?? 0) - (s.start ?? 0))));
  while (shotSeconds.length < n) shotSeconds.push(3);
  shotSeconds = shotSeconds.slice(0, n);
  const total = shotSeconds.reduce((a, b) => a + b, 0);
  if (total > 60) {
    const scale = 60 / total;
    shotSeconds = shotSeconds.map((s) => clampSeconds(s * scale));
    if (shotSeconds.reduce((a, b) => a + b, 0) > 60) {
      needsConfirmation.push("shotSeconds scaled to 60s cap");
    }
  }

  const cameraPlan: Partial<Record<Shot["type"], string>> = {};
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const role = roles[i] ?? "demo";
    const hit =
      (s.cameraPresetId && getCameraPreset(s.cameraPresetId) ? s.cameraPresetId : undefined) ??
      matchCameraId(s.cameraText || "");
    if (hit) {
      cameraPlan[role] = hit;
    } else {
      needsConfirmation.push(`shot ${i + 1} camera`);
    }
  }
  // sanitizeCustomAdTemplate replaces a <2-key cameraPlan entirely (Object.assign overwrites
  // the detected id). Pad a conservative second key so a single detection survives.
  if (Object.keys(cameraPlan).length === 1) {
    if (!cameraPlan.cta) cameraPlan.cta = "push_then_hold";
    else if (!cameraPlan.demo) cameraPlan.demo = "slow_push";
  }

  const onCamera = shots.some((s) => s.onCamera);
  const hasSpeech = shots.some((s) => s.hasSpeech || (s.words && s.words.length > 0));
  const scriptPattern: FashionFields["scriptPattern"] = onCamera ? "on-camera" : hasSpeech ? "voiceover" : "none";
  const lookSource: FashionFields["lookSource"] = scriptPattern === "on-camera" ? "grid" : "accepted";

  const wordAnchors: WordAnchor[] = [];
  for (let i = 0; i < shots.length; i++) {
    for (const text of shots[i].onScreenText ?? []) {
      if (!text.trim()) continue;
      const element = classifyOnScreenText(text);
      const kw = firstWord(shots[i]);
      wordAnchors.push({
        shot: i,
        at: kw ? { keyword: kw } : "first",
        element,
        payload: payloadFor(element),
      });
    }
  }
  if (scriptPattern === "none") {
    wordAnchors.push({ shot: n - 1, at: "first", element: "sfx", payload: payloadFor("sfx") });
  }

  const captionPreset = majorityCaption(shots);
  const taglineZh = `${n} 镜结构草稿`;
  const taglineEn = `${n}-shot structure draft`;
  const scriptHintZh = `共 ${n} 镜，口播模式 ${scriptPattern}，姿态按序列排布`;

  const raw: AdTemplate = {
    id: CUSTOM_AD_TEMPLATE_ID,
    kind: "fashion",
    emoji: "👗",
    name: { zh: "对标派生模板", en: "Derived template" },
    tagline: { zh: taglineZh, en: taglineEn },
    group: onCamera ? "presenter" : "product_show",
    goodFor: ["fashion"],
    styleType: onCamera ? "talking_head" : "scenario",
    videoMode: onCamera ? "live_presenter" : "scene_demo",
    look: "daylight_clean",
    cameraPlan,
    compose: { captionPreset, bgm: "chill", bgmDuck: true, quality: "standard" },
    scriptHint: { zh: scriptHintZh },
    fashion: {
      poseSequence,
      shotRoles: roles,
      shotSeconds,
      lookSource,
      lock: { face: true, garmentPattern: true, noOutfitChange: true },
      negative: { ...FASHION_NEGATIVE },
      scriptPattern,
      wordAnchors,
      slots: { model: true, garmentSet: true, hook: false },
      derivedFrom: {
        referenceId: meta.referenceId,
        derivedAt: new Date().toISOString(),
        shotCount: n,
      },
    },
  };

  const fashionIssues = sanitizeFashionFields(raw.fashion).issues;
  needsConfirmation.push(...fashionIssues);

  const draft = sanitizeCustomAdTemplate(raw);
  if (!draft) {
    needsConfirmation.push("sanitize rejected draft");
    return { draft: raw, needsConfirmation };
  }
  return { draft, needsConfirmation };
}
