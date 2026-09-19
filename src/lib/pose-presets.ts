/**
 * Pose preset library for fashion Looks (garment-on-model stills).
 *
 * Why this exists: a Look is only useful if the same garment can be seen from a
 * predictable set of angles that a template can reference by id (front → side →
 * back → walk). Letting the image model improvise poses yields unrepeatable
 * results that can neither be scored per-pose nor mapped onto a shot sequence.
 * A fixed vocabulary keeps Looks comparable across garments and templates.
 *
 * Pure data + pure functions, no I/O. Names/prompts are bilingual data, not i18n
 * keys (same convention as camera-presets.ts / look-presets.ts).
 */

/** Garment categories a Look request can carry (also the `garments.category` enum). */
export const GARMENT_CATEGORIES = ["tops", "bottoms", "one-pieces", "outerwear", "shoes", "accessory"] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export type PoseFraming = "full" | "half" | "detail";
export type PoseAspect = "3:4" | "9:16";

export interface PosePreset {
  id: string;
  /** Display name (picker label) */
  name: { zh: string; en: string };
  /** Pose description injected into the Look prompt */
  prompt: { zh: string; en: string };
  /** Recommended output aspect for this pose */
  aspect: PoseAspect;
  /** How much of the body the frame covers */
  framing: PoseFraming;
  /** Garment categories this pose cannot showcase (e.g. a torso detail shot hides shoes) */
  excludeCategories?: GarmentCategory[];
  /** Camera presets (camera-presets.ts ids) that naturally suit this pose when animated */
  suggestedCamera?: string[];
}

export const POSE_PRESETS: PosePreset[] = [
  {
    id: "front_stand",
    name: { zh: "正面站姿", en: "Front Stand" },
    prompt: {
      zh: "正面全身站姿，双脚自然分开与肩同宽，重心居中，双臂自然下垂或一手轻搭腰侧，肩膀放松，直视镜头",
      en: "front-facing full-body stance, feet shoulder-width apart, weight centered, arms relaxed at the sides or one hand resting lightly on the hip, shoulders relaxed, looking straight at the camera",
    },
    aspect: "3:4",
    framing: "full",
    suggestedCamera: ["slow_push", "locked_on"],
  },
  {
    id: "three_quarter",
    name: { zh: "四分之三侧身", en: "Three-Quarter" },
    prompt: {
      zh: "身体转向约 45 度的四分之三侧身全身姿态，前脚略向前，后手自然垂落，头部微转回镜头方向，显出服装的轮廓与腰线",
      en: "three-quarter full-body pose turned about 45 degrees, front foot slightly forward, back arm relaxed, head turned gently back toward the camera to reveal the garment silhouette and waistline",
    },
    aspect: "3:4",
    framing: "full",
    suggestedCamera: ["arc_quarter", "orbit_slow"],
  },
  {
    id: "side",
    name: { zh: "侧面", en: "Side Profile" },
    prompt: {
      zh: "完全侧身的全身姿态，肩线与镜头垂直，双臂自然，展示服装的侧面版型、厚度与垂坠感",
      en: "full side-profile full-body pose with the shoulder line perpendicular to the camera, arms relaxed, showing the garment's side cut, thickness and drape",
    },
    aspect: "3:4",
    framing: "full",
    suggestedCamera: ["lateral_track", "body_orbit"],
  },
  {
    id: "back",
    name: { zh: "背面", en: "Back View" },
    prompt: {
      zh: "完全背对镜头的全身姿态，头部可略向一侧回望，双臂自然，展示服装背部剪裁、拼接与下摆",
      en: "full-body pose fully facing away from the camera, head may glance slightly over one shoulder, arms relaxed, showing the garment's back cut, seams and hem",
    },
    aspect: "3:4",
    framing: "full",
    suggestedCamera: ["body_orbit", "slow_push"],
  },
  {
    id: "walk_toward",
    name: { zh: "走向镜头", en: "Walk Toward" },
    prompt: {
      zh: "自然向镜头走来的全身动态定格，一脚在前正落地，另一脚后跟微抬，手臂随步伐自然摆动，服装下摆与衣料随动作带出轻微动势",
      en: "full-body mid-stride frame walking toward the camera, one foot landing forward, the back heel slightly lifted, arms swinging naturally with the step, hem and fabric carrying a light sense of motion",
    },
    aspect: "9:16",
    framing: "full",
    suggestedCamera: ["follow_track", "pull_reveal"],
  },
  {
    id: "hands_pocket",
    name: { zh: "插兜半身", en: "Hands in Pockets" },
    prompt: {
      zh: "半身姿态，双手或单手轻插口袋，身体略放松微侧，肩膀自然，表情松弛，突出上身服装的版型与面料",
      en: "half-body pose with one or both hands casually in the pockets, body slightly turned and relaxed, natural shoulders, easy expression, highlighting the upper garment's fit and fabric",
    },
    aspect: "3:4",
    framing: "half",
    excludeCategories: ["shoes"],
    suggestedCamera: ["slow_push", "handheld_real"],
  },
  {
    id: "seated",
    name: { zh: "坐姿", en: "Seated" },
    prompt: {
      zh: "自然坐姿全身，坐在简洁的凳子或台阶上，一腿微伸一腿弯曲，上身略前倾，一手撑在膝上，服装在坐姿下的褶皱与垂坠自然",
      en: "natural seated full-body pose on a simple stool or step, one leg extended and one bent, torso leaning slightly forward, one hand resting on the knee, the garment folding and draping naturally in the seated position",
    },
    aspect: "3:4",
    framing: "full",
    suggestedCamera: ["slow_push", "arc_quarter"],
  },
  {
    id: "detail_torso",
    name: { zh: "上身细节", en: "Torso Detail" },
    prompt: {
      zh: "胸口到腰部的近景细节，身体微侧，一手轻捏衣料或整理衣领，清晰展示面料纹理、纽扣、缝线与图案",
      en: "close detail from chest to waist, body slightly turned, one hand lightly pinching the fabric or adjusting the collar, clearly showing fabric texture, buttons, stitching and pattern",
    },
    aspect: "3:4",
    framing: "detail",
    excludeCategories: ["shoes", "bottoms"],
    suggestedCamera: ["macro_glide", "focus_shift"],
  },
];

/** Lookup by pose id (undefined for unknown ids). */
export function getPosePreset(id: string | undefined | null): PosePreset | undefined {
  if (!id) return undefined;
  return POSE_PRESETS.find((p) => p.id === id);
}

/** True when `id` names a known pose preset. */
export function isPoseId(id: unknown): id is string {
  return typeof id === "string" && POSE_PRESETS.some((p) => p.id === id);
}

/**
 * Poses that can showcase every one of the given garment categories. With no
 * categories (or an empty list) every pose qualifies.
 */
export function listPosesFor(categories?: readonly GarmentCategory[] | null): PosePreset[] {
  if (!categories || categories.length === 0) return [...POSE_PRESETS];
  return POSE_PRESETS.filter((p) => !categories.some((c) => p.excludeCategories?.includes(c)));
}

/** Default pose sequence used when a fashion template supplies none usable. */
export const DEFAULT_POSE_SEQUENCE: readonly string[] = ["front_stand", "three_quarter", "back", "walk_toward"];
