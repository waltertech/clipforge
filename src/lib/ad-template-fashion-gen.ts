/**
 * Prompt + parse helpers for POST /api/ad-template/generate kind:"fashion".
 * Kept separate from the route so unit tests can cover the vocabulary list and
 * the "force kind=fashion" parse without spinning up Next.
 */
import { extractJSON } from "@/lib/script-engine/generator";
import { AD_TEMPLATE_GROUPS } from "@/lib/ad-templates";
import { CAMERA_PRESETS } from "@/lib/camera-presets";
import { LOOK_PRESETS } from "@/lib/look-presets";
import { GARMENT_CATEGORIES, POSE_PRESETS } from "@/lib/pose-presets";

export function buildFashionTemplatePrompt(input: {
  brief?: string;
  garmentCategories?: string[];
  productName?: string;
}): string {
  const poses = POSE_PRESETS.map((p) => `${p.id} — ${p.name.zh}/${p.name.en}: ${p.prompt.zh}`).join("\n");
  const cameras = CAMERA_PRESETS.map((c) => `${c.id} — ${c.name.zh}/${c.name.en}: ${c.prompt.zh}`).join("\n");
  const looks = LOOK_PRESETS.map((l) => `${l.id}(${l.name.zh})`).join("、");
  const groups = AD_TEMPLATE_GROUPS.map((g) => `${g.id}(${g.name.zh})`).join("、");
  const cats = (input.garmentCategories ?? []).filter((c) => (GARMENT_CATEGORIES as readonly string[]).includes(c));
  const brief = [input.productName, input.brief].filter((s) => typeof s === "string" && s.trim()).join(" / ");
  return [
    `为时装短视频定制一份 FashionTemplate 配方。所有 id 只能从下列词表中选，禁止自造 pose / camera id。`,
    brief ? `创作brief：${brief.slice(0, 500)}` : "创作brief：（未提供，给一条通用的日间成衣展示结构）",
    cats.length ? `适用服装类目 garmentCategories：${cats.join("、")}` : `适用服装类目可选：${GARMENT_CATEGORIES.join("、")}`,
    ``,
    `姿态词表 POSE_PRESETS（poseSequence 只能填这些 id）：`,
    poses,
    ``,
    `运镜词表 CAMERA_PRESETS（cameraPlan 的值只能填这些 id）：`,
    cameras,
    ``,
    `其他词表：`,
    `- look：${looks}`,
    `- group：${groups}`,
    `- styleType：pain-point、scenario、comparison、story、drama、reversal、interview、unboxing、product_pov、talking_head`,
    `- videoMode：product_closeup、graphic_montage、scene_demo、live_presenter`,
    `- captionPreset：standard、bold、minimal、karaoke；bgm：none、upbeat、chill、energetic、emotional；quality：fast、standard、hd`,
    `- shotRoles：hook、pain_point、product_reveal、demo、social_proof、cta`,
    `- lookSource：accepted、grid；scriptPattern：none、voiceover、on-camera`,
    `- wordAnchors.element：price_card、selling_point、brand_tag、sfx、caption_emphasis；at：first、last 或 {keyword}`,
    ``,
    `要求：kind 必须是 "fashion"；fashion.poseSequence 长度 1–9，每项都是上面的 pose id；shotRoles / shotSeconds 与 poseSequence 等长；lock 三项布尔；negative.zh 与 negative.en 非空；scriptHint 只写结构（镜数/口播模式/姿态顺序），不要承诺功效。无口播时 scriptPattern=none 且 wordAnchors 只允许 sfx。`,
    `只输出一个 JSON 对象：`,
    `{"kind":"fashion","name":{"zh":"≤8字","en":"English name"},"tagline":{"zh":"结构一句话","en":"one-line structure"},"emoji":"一个emoji","group":"...","goodFor":["fashion"],"styleType":"...","videoMode":"...","look":"...","cameraPlan":{"hook":"...","demo":"...","cta":"..."},"compose":{"captionPreset":"...","bgm":"chill","bgmDuck":true,"quality":"standard"},"scriptHint":{"zh":"结构说明"},"fashion":{"poseSequence":["front_stand"],"shotRoles":["hook"],"shotSeconds":[3],"lookSource":"accepted","garmentCategories":[],"lock":{"face":true,"garmentPattern":true,"noOutfitChange":true},"negative":{"zh":"...","en":"..."},"scriptPattern":"none","wordAnchors":[{"shot":0,"at":"first","element":"sfx","payload":"whoosh_soft"}],"slots":{"model":true,"garmentSet":true,"hook":false}}}`,
  ].join("\n");
}

const FASHION_TOP_KEYS = [
  "poseSequence",
  "shotRoles",
  "shotSeconds",
  "lookSource",
  "garmentCategories",
  "lock",
  "negative",
  "scriptPattern",
  "wordAnchors",
  "slots",
  "derivedFrom",
] as const;

/** Pull a JSON object out of LLM text and force `kind: "fashion"`. Null on unparseable input. */
export function parseFashionTemplateOutput(text: string): Record<string, unknown> | null {
  try {
    const json = extractJSON(text || "");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    let r = parsed as Record<string, unknown>;
    if (r.template && typeof r.template === "object" && !Array.isArray(r.template)) {
      r = r.template as Record<string, unknown>;
    }
    r.kind = "fashion";
    if (!r.fashion || typeof r.fashion !== "object" || Array.isArray(r.fashion)) {
      const fashion: Record<string, unknown> = {};
      for (const k of FASHION_TOP_KEYS) {
        if (k in r) fashion[k] = r[k];
      }
      r.fashion = fashion;
    }
    return r;
  } catch {
    return null;
  }
}

/** True when sanitizeFashionFields dropped at least one unknown pose id (poseSequence changed). */
export function hasUnknownPoseIssue(issues: string[]): boolean {
  return issues.some((i) => /unknown pose id/i.test(i));
}
