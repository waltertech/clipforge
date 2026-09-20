/**
 * Pure planner for POST /api/project/from-look.
 *
 * Turns a fashion template + accepted Looks + garment set + presenter into the
 * project / script fields the existing assets → i2v → compose pipeline already
 * understands. No I/O — the route does the inserts.
 */
import type { Shot } from "@/lib/db/schema";
import type { AdTemplate } from "@/lib/ad-templates";
import {
  buildFashionShots,
  type FashionLookInput,
  type FashionShotsResult,
} from "@/lib/fashion-shots";

const SCRIPT_STYLE_ENUM = [
  "pain_point",
  "scene",
  "comparison",
  "story",
  "drama",
  "reversal",
  "interview",
  "unboxing",
  "product_pov",
  "talking_head",
  "custom",
] as const;

export type FromLookScriptStyle = (typeof SCRIPT_STYLE_ENUM)[number];

export interface FromLookCharacter {
  id: string;
  name: string;
  appearance?: string;
  referenceImages: string[];
}

export interface FromLookGarment {
  name: string;
  frontUrl: string;
}

export interface FromLookGarmentSet {
  name: string;
  garments: FromLookGarment[];
}

export interface PlanFromLookInput {
  template: AdTemplate;
  looks: FashionLookInput[];
  garmentSet: FromLookGarmentSet;
  character: FromLookCharacter;
  lang?: "zh" | "en";
}

export interface FromLookProjectFields {
  name: string;
  productName: string;
  productCategory: "fashion";
  productDescription: string;
  productImages: string[];
  videoMode: AdTemplate["videoMode"];
}

export interface FromLookScriptFields {
  styleType: FromLookScriptStyle;
  title: string;
  totalDuration: number;
  shots: Shot[];
  characters: Array<{
    id: string;
    name: string;
    gender: "female";
    appearance?: string;
  }>;
}

export interface PlanFromLookResult extends FashionShotsResult {
  projectFields: FromLookProjectFields;
  scriptFields: FromLookScriptFields;
}

/**
 * Map an AdTemplate.styleType (UI / form vocabulary) onto the scripts.styleType enum.
 * "scenario" → "scene", "pain-point" → "pain_point"; unknown values become "custom".
 */
export function mapAdTemplateStyleType(styleType: string): FromLookScriptStyle {
  const raw = styleType.trim().toLowerCase();
  if (raw === "scenario") return "scene";
  if (raw === "pain-point") return "pain_point";
  if ((SCRIPT_STYLE_ENUM as readonly string[]).includes(raw)) return raw as FromLookScriptStyle;
  return "custom";
}

export function planFromLook(input: PlanFromLookInput): PlanFromLookResult {
  const lang = input.lang === "en" ? "en" : "zh";
  const { shots, keyframes } = buildFashionShots(input.template, input.looks, {
    garmentSetName: input.garmentSet.name,
    characterId: input.character.id,
    lang,
  });

  const productImages = input.garmentSet.garments
    .map((g) => g.frontUrl)
    .filter((url) => typeof url === "string" && url.length > 0);
  const garmentNames = input.garmentSet.garments.map((g) => g.name).filter(Boolean);
  const productDescription =
    garmentNames.join(" · ") || input.template.tagline[lang] || input.template.tagline.zh;

  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 0), 0);
  const title = input.template.name[lang] || input.template.name.zh;

  return {
    shots,
    keyframes,
    projectFields: {
      name: `${input.garmentSet.name} · ${title}`,
      productName: input.garmentSet.name,
      productCategory: "fashion",
      productDescription,
      productImages,
      videoMode: input.template.videoMode,
    },
    scriptFields: {
      styleType: mapAdTemplateStyleType(input.template.styleType),
      title,
      totalDuration,
      shots,
      characters: [
        {
          id: input.character.id,
          name: input.character.name,
          gender: "female",
          ...(input.character.appearance !== undefined && { appearance: input.character.appearance }),
        },
      ],
    },
  };
}
