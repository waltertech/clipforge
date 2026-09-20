/**
 * Look prompt builder — one multi-reference image-edit prompt that dresses the
 * presenter in the garment set in a preset pose.
 *
 * Reference-image contract (same positional convention as storyboard-grid.ts):
 * the images array is [...modelRefs, ...garment fronts, ...garment backs?], and
 * the prompt cites each by position. Every garment is described inner → outer in
 * ONE pass — chaining single-garment try-ons drifts identity and colour by the
 * third garment (Drape's field finding), so layering is a prompt matter, not a
 * pipeline matter.
 *
 * Pure function, no I/O.
 */
import { getLookPreset } from "@/lib/look-presets";
import { realFaceLine } from "@/lib/presenters";
import type { GarmentCategory } from "@/lib/pose-presets";
import type { LookRequest } from "./types";

const CJK_RE = /[一-鿿぀-ヿ가-힯]/;

const CATEGORY_LABELS: Record<GarmentCategory, { zh: string; en: string }> = {
  tops: { zh: "上装", en: "top" },
  bottoms: { zh: "下装", en: "bottoms" },
  "one-pieces": { zh: "连体/连衣", en: "one-piece" },
  outerwear: { zh: "外套", en: "outerwear" },
  shoes: { zh: "鞋", en: "shoes" },
  accessory: { zh: "配饰", en: "accessory" },
};

const VIEW_LABELS: Record<"flat" | "on-model", { zh: string; en: string }> = {
  flat: { zh: "平铺商品图", en: "flat-lay product photo" },
  "on-model": { zh: "上身参考图", en: "on-model reference photo" },
};

/** Pick the prompt language: explicit > CJK in user text > zh default. */
export function pickLookLang(req: Pick<LookRequest, "lang" | "garments" | "modelAppearance">): "zh" | "en" {
  if (req.lang) return req.lang;
  const text = [req.modelAppearance ?? "", ...req.garments.map((g) => g.notes ?? "")].join(" ").trim();
  if (!text) return "zh";
  return CJK_RE.test(text) ? "zh" : "en";
}

/**
 * Ordered reference-image URLs matching the positions the prompt cites:
 * model refs first, then each garment's front, then any back views.
 */
export function lookReferenceImages(req: LookRequest): string[] {
  const backs = req.garments.map((g) => g.backUrl).filter((u): u is string => Boolean(u));
  return [...req.modelRefs, ...req.garments.map((g) => g.url), ...backs];
}

/** Build the Look prompt. Language follows `pickLookLang`. */
export function buildLookPrompt(req: LookRequest): string {
  const lang = pickLookLang(req);
  const look = req.lookPresetId ? getLookPreset(req.lookPresetId) : undefined;
  const modelCount = req.modelRefs.length;
  const anchorText = req.modelAppearance ?? "";

  const garmentLines: string[] = [];
  const backLines: string[] = [];
  let pos = modelCount;
  req.garments.forEach((g, i) => {
    pos += 1;
    const cat = CATEGORY_LABELS[g.category];
    const view = VIEW_LABELS[g.view];
    const layer =
      req.garments.length > 1
        ? lang === "zh"
          ? `（第 ${i + 1} 层，${i === 0 ? "最内" : i === req.garments.length - 1 ? "最外" : "中间"}）`
          : ` (layer ${i + 1}, ${i === 0 ? "innermost" : i === req.garments.length - 1 ? "outermost" : "middle"})`
        : "";
    const notes = g.notes?.trim();
    garmentLines.push(
      lang === "zh"
        ? `第 ${pos} 张参考图是${view.zh}：${cat.zh}${layer}${notes ? `，要求：${notes}` : ""}。`
        : `Reference image ${pos} is a ${view.en}: ${cat.en}${layer}${notes ? `; requirements: ${notes}` : ""}.`
    );
  });
  req.garments.forEach((g) => {
    if (!g.backUrl) return;
    pos += 1;
    const cat = CATEGORY_LABELS[g.category];
    backLines.push(
      lang === "zh"
        ? `第 ${pos} 张参考图是该${cat.zh}的背面，背面视角时以此为准。`
        : `Reference image ${pos} is the back of that ${cat.en}; use it whenever the back is visible.`
    );
  });

  const lockLines: string[] = [];
  if (req.lock.garmentPattern) {
    lockLines.push(
      lang === "zh"
        ? "服装的颜色、图案、印花位置、面料质感、版型与长度必须与服装参考图完全一致，不得重新设计、不得改色、不得增减细节；平铺图要按真实穿着状态合理贴合身体。"
        : "Garment colour, pattern, print placement, fabric texture, cut and length must match the garment references exactly — no redesign, no recolouring, no added or removed details; flat-lay garments must be worn realistically on the body."
    );
  }
  if (req.lock.face) {
    lockLines.push(
      lang === "zh"
        ? `人物的脸型、五官、发型、发色与体型必须与${modelCount > 0 ? `第 1${modelCount > 1 ? `–${modelCount}` : ""} 张模特参考图` : "人物设定"}完全一致，是同一个人。`
        : `The person's face, features, hairstyle, hair colour and body shape must match ${modelCount > 0 ? `model reference image${modelCount > 1 ? `s 1–${modelCount}` : " 1"}` : "the character description"} exactly — the same person.`
    );
  }

  if (lang === "zh") {
    return [
      `一张时装 Look 单人照片，画幅 ${req.aspect}，${req.pose.framing === "detail" ? "近景细节" : req.pose.framing === "half" ? "半身" : "全身"}构图。`,
      modelCount > 0
        ? `第 1${modelCount > 1 ? `–${modelCount}` : ""} 张参考图是模特的定妆参考（只作人物参考，不作为画面内容）。`
        : "",
      anchorText ? `人物设定：${anchorText}。` : "",
      ...garmentLines,
      ...backLines,
      `姿态：${req.pose.prompt.zh}。`,
      look ? `光线与背景：${look.image.zh}。` : "光线与背景：柔和均匀的影棚光，浅灰或米白纯色背景，无杂物。",
      ...lockLines,
      realFaceLine(anchorText || "中文") + "。",
      "硬性要求：画面里不出现任何文字、标签、水印、边框或拼贴分格；单人、完整可见、无多余肢体；服装穿着自然、无穿模。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `A single fashion Look photograph, ${req.aspect} aspect, ${req.pose.framing === "detail" ? "close detail" : req.pose.framing === "half" ? "half-body" : "full-body"} framing.`,
    modelCount > 0
      ? `Reference image${modelCount > 1 ? `s 1–${modelCount}` : " 1"} ${modelCount > 1 ? "are" : "is"} the model's character reference (identity only, not scene content).`
      : "",
    anchorText ? `Character: ${anchorText}.` : "",
    ...garmentLines,
    ...backLines,
    `Pose: ${req.pose.prompt.en}.`,
    look ? `Lighting and backdrop: ${look.image.en}.` : "Lighting and backdrop: soft even studio light, plain light-gray or off-white seamless backdrop, no clutter.",
    ...lockLines,
    realFaceLine(anchorText || "english") + ".",
    "Hard rules: no text, tags, watermarks, borders or collage cells anywhere; one person, fully visible, no extra limbs; the garments sit naturally on the body with no clipping.",
  ]
    .filter(Boolean)
    .join("\n");
}
