/**
 * Fashion Look → shot list. Maps a fashion template's poseSequence onto the
 * existing Shot[] contract so project creation can skip the script-LLM
 * storyboard pass and feed accepted Looks (or a later grid pass) as keyframes.
 *
 * Pure functions, no I/O.
 */
import type { Shot } from "@/lib/db/schema";
import {
  defaultFashionShotRoles,
  defaultFashionShotSeconds,
  isFashionTemplate,
  type AdTemplate,
} from "@/lib/ad-templates";
import { getCameraPreset } from "@/lib/camera-presets";
import { getPosePreset } from "@/lib/pose-presets";

export interface FashionLookInput {
  poseId: string;
  imageUrl: string;
  status: string;
}

export class MissingLooksError extends Error {
  readonly missingPoses: string[];
  constructor(missingPoses: string[]) {
    super(`Missing accepted Looks for poses: ${missingPoses.join(", ")}`);
    this.name = "MissingLooksError";
    this.missingPoses = missingPoses;
  }
}

export interface FashionShotsOptions {
  garmentSetName?: string;
  characterId?: string;
  lang?: "zh" | "en";
  totalSeconds?: number;
}

export interface FashionShotsResult {
  shots: Shot[];
  /** shotId → accepted Look imageUrl */
  keyframes: Record<number, string>;
}

/**
 * Unique pose ids in `fashion.poseSequence` that have no accepted Look, in
 * first-seen sequence order (duplicates of the same missing pose appear once).
 */
export function missingPosesFor(template: AdTemplate, looks: FashionLookInput[]): string[] {
  const seq = template.fashion?.poseSequence;
  if (!seq) return [];
  const accepted = new Set(looks.filter((l) => l.status === "accepted").map((l) => l.poseId));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const poseId of seq) {
    if (!accepted.has(poseId) && !seen.has(poseId)) {
      seen.add(poseId);
      missing.push(poseId);
    }
  }
  return missing;
}

function firstAcceptedUrl(looks: FashionLookInput[], poseId: string): string | undefined {
  return looks.find((l) => l.poseId === poseId && l.status === "accepted")?.imageUrl;
}

function garmentSuffix(name: string | undefined, lang: "zh" | "en"): string {
  if (!name) return "";
  return lang === "zh" ? `，穿着「${name}」` : `, wearing "${name}"`;
}

function resolveCamera(
  template: AdTemplate,
  type: Shot["type"],
  poseId: string,
  lang: "zh" | "en"
): string {
  const planId = template.cameraPlan[type];
  const fromPlan = planId ? getCameraPreset(planId)?.prompt[lang] : undefined;
  if (fromPlan) return fromPlan;
  const suggestedId = getPosePreset(poseId)?.suggestedCamera?.[0];
  const fromSuggested = suggestedId ? getCameraPreset(suggestedId)?.prompt[lang] : undefined;
  return fromSuggested ?? "";
}

/**
 * Build one Shot per pose in the fashion template.
 *
 * `lookSource === "grid"`: still emit shots, but return an EMPTY keyframes map
 * and do not require accepted Looks — the storyboard-grid pass will render
 * keyframes later. Any other lookSource (typically `"accepted"`) requires an
 * accepted Look for every pose and throws MissingLooksError listing the gaps.
 */
export function buildFashionShots(
  template: AdTemplate,
  looks: FashionLookInput[],
  opts?: FashionShotsOptions
): FashionShotsResult {
  if (!isFashionTemplate(template)) {
    throw new Error("buildFashionShots requires a fashion template");
  }

  const fashion = template.fashion;
  const n = fashion.poseSequence.length;
  const roles = fashion.shotRoles ?? defaultFashionShotRoles(n);
  const seconds = fashion.shotSeconds ?? defaultFashionShotSeconds(n, opts?.totalSeconds ?? 12);
  const lang = opts?.lang ?? "zh";
  const suffix = garmentSuffix(opts?.garmentSetName, lang);
  const fromGrid = fashion.lookSource === "grid";

  if (!fromGrid) {
    const missing = missingPosesFor(template, looks);
    if (missing.length > 0) throw new MissingLooksError(missing);
  }

  const shots: Shot[] = [];
  const keyframes: Record<number, string> = {};

  for (let i = 0; i < n; i++) {
    const poseId = fashion.poseSequence[i];
    const type = (roles[i] ?? defaultFashionShotRoles(n)[i] ?? "demo") as Shot["type"];
    const duration = seconds[i] ?? defaultFashionShotSeconds(n, opts?.totalSeconds ?? 12)[i] ?? 3;
    const pose = getPosePreset(poseId);
    const name = pose?.name[lang] ?? poseId;
    const promptText = pose?.prompt[lang] ?? "";
    const shotId = i + 1;
    shots.push({
      shotId,
      type,
      duration,
      description: `${name}：${promptText}${suffix}`,
      camera: resolveCamera(template, type, poseId, lang),
      visualSource: "user_upload",
      transition: "direct_concat",
      voiceover: "",
      ...(opts?.characterId !== undefined && { characterId: opts.characterId }),
    });
    if (!fromGrid) {
      const url = firstAcceptedUrl(looks, poseId);
      if (url) keyframes[shotId] = url;
    }
  }

  return { shots, keyframes };
}
