/**
 * Client for the Fashion Look HTTP contract (garments, garment-sets, looks).
 *
 * All browser fetch calls for this feature live here so pages stay UI-only and
 * so the parallel API work can land against one typed surface.
 */
import { POSE_PRESETS, type GarmentCategory } from "@/lib/pose-presets";
import { MAX_GARMENTS_PER_LOOK } from "@/lib/tryon/types";
import type { LookCharacterSnapshot, LookScore, TryOnRouteId } from "@/lib/tryon/types";

export type { GarmentCategory, LookCharacterSnapshot, LookScore, TryOnRouteId };

export type GarmentView = "flat" | "on-model";

export interface Garment {
  id: string;
  name: string;
  category: GarmentCategory;
  view: GarmentView;
  frontUrl: string;
  backUrl: string | null;
  colorTags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GarmentSet {
  id: string;
  name: string;
  garmentIds: string[];
  characterId: string | null;
  garments: Garment[];
  createdAt: string;
  updatedAt: string;
}

export type LookStatus = "pending" | "generating" | "candidate" | "accepted" | "rejected" | "failed";

export interface Look {
  id: string;
  garmentSetId: string;
  characterId: string;
  characterSnapshot: LookCharacterSnapshot | null;
  poseId: string;
  lookPresetId: string | null;
  route: TryOnRouteId;
  provider: string | null;
  model: string | null;
  imageUrl: string | null;
  score: LookScore | null;
  status: LookStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const LOOK_POLL_INTERVAL_MS = 3000;
export const GARMENT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const GARMENT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_SET_GARMENTS = MAX_GARMENTS_PER_LOOK;

export type LlmConfigPayload = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  visionModel?: string;
};

export type TryonPayload = {
  fashnApiKey?: string;
  fashnBaseUrl?: string;
};

export const GARMENT_CATEGORY_VALUES: readonly GarmentCategory[] = [
  "tops",
  "bottoms",
  "one-pieces",
  "outerwear",
  "shoes",
  "accessory",
];

export class FashionApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FashionApiError";
    this.status = status;
  }
}

export interface ImageFileLike {
  type: string;
  size: number;
  name?: string;
}

/** jpeg/png/webp and ≤ 20 MB — used before POST /api/garments. */
export function validateGarmentImage(file: ImageFileLike): "ok" | "type" | "size" {
  const mimeOk = (GARMENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
  const extOk = file.name ? /\.(jpe?g|png|webp)$/i.test(file.name) : false;
  if (!mimeOk && !extOk) return "type";
  if (file.size > GARMENT_MAX_IMAGE_BYTES) return "size";
  return "ok";
}

/** Comma / Chinese-comma list → unique trimmed tags (first spelling wins). */
export function parseColorTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,，]/)) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function formatColorTagsInput(tags: readonly string[]): string {
  return tags.join(", ");
}

export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (index < 0 || index >= items.length || next < 0 || next >= items.length) return [...items];
  const copy = items.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

export function isLookInFlight(status: LookStatus): boolean {
  return status === "pending" || status === "generating";
}

export type LookScoreTone = "green" | "amber" | "red";

/** ≥4 green, 3–4 amber, <3 red; null when overall is missing. */
export function lookScoreTone(overall: number | null | undefined): LookScoreTone | null {
  if (overall == null || !Number.isFinite(overall)) return null;
  if (overall >= 4) return "green";
  if (overall >= 3) return "amber";
  return "red";
}

export type LookFilter = "all" | "accepted" | "candidates" | "failed";

export function matchesLookFilter(look: Look, filter: LookFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "accepted":
      return look.status === "accepted";
    case "failed":
      return look.status === "failed";
    case "candidates":
      return look.status === "candidate" || isLookInFlight(look.status);
    default:
      return true;
  }
}

export function groupLooksByPoseId(looks: readonly Look[]): Array<{ poseId: string; looks: Look[] }> {
  const groups = new Map<string, Look[]>();
  for (const look of looks) {
    const list = groups.get(look.poseId);
    if (list) list.push(look);
    else groups.set(look.poseId, [look]);
  }
  const result: Array<{ poseId: string; looks: Look[] }> = [];
  const known = POSE_PRESETS.map((p) => p.id);
  for (const id of known) {
    const list = groups.get(id);
    if (list) result.push({ poseId: id, looks: list });
  }
  for (const [id, list] of groups) {
    if (!known.includes(id)) result.push({ poseId: id, looks: list });
  }
  return result;
}

export function hasConfiguredImageProvider(
  providers: Record<string, { enabled?: boolean; apiKey?: string }>,
  defaultImageModel: string | undefined,
): boolean {
  if (!defaultImageModel) return false;
  return Object.values(providers).some((p) => Boolean(p.enabled && p.apiKey));
}

export function buildGarmentsQuery(params: { category?: string; q?: string } = {}): string {
  const sp = new URLSearchParams();
  if (params.category && params.category !== "all") sp.set("category", params.category);
  const q = params.q?.trim();
  if (q) sp.set("q", q);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return `Request failed (${status})`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FashionApiError(errorMessage(data, res.status), res.status);
  }
  if (data == null || typeof data !== "object") {
    throw new FashionApiError("Invalid response", res.status);
  }
  return data as T;
}

export async function listGarments(params: { category?: string; q?: string } = {}): Promise<{ garments: Garment[] }> {
  return request<{ garments: Garment[] }>(`/api/garments${buildGarmentsQuery(params)}`);
}

export interface CreateGarmentInput {
  name: string;
  category: GarmentCategory;
  view: GarmentView;
  notes?: string;
  colorTags?: string[];
  front: File;
  back?: File | null;
}

export async function createGarment(input: CreateGarmentInput): Promise<{ garment: Garment }> {
  const body = new FormData();
  body.append("name", input.name);
  body.append("category", input.category);
  body.append("view", input.view);
  if (input.notes) body.append("notes", input.notes);
  if (input.colorTags && input.colorTags.length > 0) {
    body.append("colorTags", JSON.stringify(input.colorTags));
  }
  body.append("front", input.front);
  if (input.back) body.append("back", input.back);
  return request<{ garment: Garment }>("/api/garments", { method: "POST", body });
}

export interface PatchGarmentInput {
  name?: string;
  category?: GarmentCategory;
  view?: GarmentView;
  notes?: string | null;
  colorTags?: string[];
}

export async function patchGarment(id: string, input: PatchGarmentInput): Promise<{ garment: Garment }> {
  return request<{ garment: Garment }>(`/api/garments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteGarment(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/garments/${id}`, { method: "DELETE" });
}

export async function listGarmentSets(): Promise<{ sets: GarmentSet[] }> {
  return request<{ sets: GarmentSet[] }>("/api/garment-sets");
}

export interface CreateGarmentSetInput {
  name: string;
  garmentIds: string[];
  characterId?: string | null;
}

export async function createGarmentSet(input: CreateGarmentSetInput): Promise<{ set: GarmentSet }> {
  return request<{ set: GarmentSet }>("/api/garment-sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      garmentIds: input.garmentIds,
      ...(input.characterId ? { characterId: input.characterId } : {}),
    }),
  });
}

export interface PatchGarmentSetInput {
  name?: string;
  garmentIds?: string[];
  characterId?: string | null;
}

export async function patchGarmentSet(id: string, input: PatchGarmentSetInput): Promise<{ set: GarmentSet }> {
  return request<{ set: GarmentSet }>(`/api/garment-sets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteGarmentSet(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/garment-sets/${id}`, { method: "DELETE" });
}

export async function listLooks(garmentSetId?: string): Promise<{ looks: Look[] }> {
  const qs = garmentSetId ? `?garmentSetId=${encodeURIComponent(garmentSetId)}` : "";
  return request<{ looks: Look[] }>(`/api/looks${qs}`);
}

export interface GenerateLooksInput {
  garmentSetId: string;
  character: {
    id: string;
    name: string;
    appearance: string;
    referenceImages: string[];
  };
  poseIds: string[];
  lookPresetId?: string | null;
  route?: TryOnRouteId;
  lock?: { face: boolean; garmentPattern: boolean };
  lang?: "zh" | "en";
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
  llmConfig?: LlmConfigPayload;
  tryon?: TryonPayload;
}

export async function generateLooks(input: GenerateLooksInput): Promise<{ lookIds: string[] }> {
  const body: Record<string, unknown> = {
    garmentSetId: input.garmentSetId,
    character: input.character,
    poseIds: input.poseIds,
    route: input.route,
    lock: input.lock,
    lang: input.lang,
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    options: input.options,
  };
  if (input.lookPresetId) body.lookPresetId = input.lookPresetId;
  if (input.baseUrl) body.baseUrl = input.baseUrl;
  if (input.llmConfig) body.llmConfig = input.llmConfig;
  if (input.tryon) body.tryon = input.tryon;
  return request<{ lookIds: string[] }>("/api/looks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchLook(
  id: string,
  action: "accept" | "reject" | "rescore",
  extra?: { llmConfig?: LlmConfigPayload; lang?: "zh" | "en" },
): Promise<{ look: Look }> {
  const body: Record<string, unknown> = { action };
  if (extra?.llmConfig) body.llmConfig = extra.llmConfig;
  if (extra?.lang) body.lang = extra.lang;
  return request<{ look: Look }>(`/api/looks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface RetryLookInput {
  poseId?: string;
  route?: TryOnRouteId;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
  llmConfig?: LlmConfigPayload;
  tryon?: TryonPayload;
  lookPresetId?: string | null;
  lock?: { face: boolean; garmentPattern: boolean };
  lang?: "zh" | "en";
}

export async function retryLook(id: string, input: RetryLookInput): Promise<{ lookId: string }> {
  const body: Record<string, unknown> = {
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    options: input.options,
  };
  if (input.poseId) body.poseId = input.poseId;
  if (input.route) body.route = input.route;
  if (input.baseUrl) body.baseUrl = input.baseUrl;
  if (input.llmConfig) body.llmConfig = input.llmConfig;
  if (input.tryon) body.tryon = input.tryon;
  if (input.lookPresetId) body.lookPresetId = input.lookPresetId;
  if (input.lock) body.lock = input.lock;
  if (input.lang) body.lang = input.lang;
  return request<{ lookId: string }>(`/api/looks/${id}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface LookExportManifest {
  garmentSet: { id: string; name: string };
  looks: Array<{
    id: string;
    poseId: string;
    status: string;
    imageUrl: string | null;
    absoluteFile: boolean;
  }>;
}

export async function exportLooks(
  garmentSetId: string,
  status: "accepted" | "all" = "accepted",
): Promise<LookExportManifest> {
  const qs = new URLSearchParams({ garmentSetId, status });
  return request<LookExportManifest>(`/api/looks/export?${qs.toString()}`);
}

export async function importLooksToProject(
  projectId: string,
  items: Array<{ lookId: string; shotId: number }>,
): Promise<{ assets: unknown[] }> {
  return request<{ assets: unknown[] }>(`/api/project/${projectId}/looks/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ looks: items }),
  });
}

/** Highest overall among candidate/accepted looks; unscored rows sort last. */
export function pickBestLookForPose(rows: readonly Look[]): Look | null {
  const eligible = rows.filter((row) => row.status === "candidate" || row.status === "accepted");
  if (eligible.length === 0) return null;
  return eligible.reduce((best, cur) => {
    const b = best.score?.overall ?? Number.NEGATIVE_INFINITY;
    const c = cur.score?.overall ?? Number.NEGATIVE_INFINITY;
    return c > b ? cur : best;
  });
}
