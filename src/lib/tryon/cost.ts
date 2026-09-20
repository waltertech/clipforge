import type { TryOnRouteId } from "./types";

export interface EstimateLookCostInput {
  route: TryOnRouteId | string;
  poses: number;
  garments: number;
  scoring: boolean;
}

export interface LookCostEstimate {
  calls: { image: number; tryon: number; vision: number };
  note: { zh: string; en: string };
}

/**
 * Pure per-batch cost shape for the Look workbench hint.
 * compose bills one image call per pose; vton bills one try-on call per pose × garment;
 * vision scoring is one call per pose when enabled.
 */
export function estimateLookCost(input: EstimateLookCostInput): LookCostEstimate {
  const poses = Math.max(0, Math.floor(input.poses) || 0);
  const garments = Math.max(0, Math.floor(input.garments) || 0);
  const route = input.route === "vton" ? "vton" : "compose";
  const image = route === "compose" ? poses : 0;
  const tryon = route === "vton" ? poses * garments : 0;
  const vision = input.scoring ? poses : 0;

  const partsZh: string[] = [];
  const partsEn: string[] = [];
  if (image > 0) {
    partsZh.push(`${image} 次生图`);
    partsEn.push(`${image} image ${image === 1 ? "call" : "calls"}`);
  }
  if (tryon > 0) {
    partsZh.push(`${tryon} 次 FASHN 试衣`);
    partsEn.push(`${tryon} FASHN try-on ${tryon === 1 ? "call" : "calls"}`);
  }
  if (vision > 0) {
    partsZh.push(`${vision} 次视觉打分`);
    partsEn.push(`${vision} scoring ${vision === 1 ? "call" : "calls"}`);
  }
  if (partsZh.length === 0) {
    partsZh.push("0 次调用");
    partsEn.push("0 calls");
  }

  return {
    calls: { image, tryon, vision },
    note: {
      zh: `约 ${partsZh.join(" + ")}`,
      en: `About ${partsEn.join(" + ")}`,
    },
  };
}
