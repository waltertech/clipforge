/**
 * Pure garment / look DTO helpers — no DB, no fs. Route handlers map rows
 * through these so the JSON contract stays in one place.
 */
import { GARMENT_CATEGORIES, type GarmentCategory } from "@/lib/pose-presets";
import type { GarmentView, LookCharacterSnapshot, LookScore, TryOnRouteId } from "@/lib/tryon/types";

export const MAX_GARMENT_NAME = 80;
export const MAX_GARMENT_NOTES = 300;
export const MAX_COLOR_TAGS = 12;
export const MAX_COLOR_TAG_LENGTH = 32;
export const MAX_GARMENT_SET_NAME = 80;
export const GARMENT_VIEWS = ["flat", "on-model"] as const;

export interface GarmentDto {
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

export interface GarmentSetDto {
  id: string;
  name: string;
  garmentIds: string[];
  characterId: string | null;
  garments: GarmentDto[];
  createdAt: string;
  updatedAt: string;
}

export interface LookDto {
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
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GarmentRow {
  id: string;
  name: string;
  category: string;
  view: string;
  frontPath: string;
  backPath: string | null;
  colorTags?: string[] | null;
  notes: string | null;
  createdAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
}

export interface GarmentSetRow {
  id: string;
  name: string;
  garmentIds: string[] | null;
  characterId: string | null;
  createdAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
}

export interface LookRow {
  id: string;
  garmentSetId: string;
  characterId: string;
  characterSnapshot?: LookCharacterSnapshot | null;
  poseId: string;
  lookPresetId?: string | null;
  route: string;
  provider?: string | null;
  model?: string | null;
  imagePath?: string | null;
  score?: LookScore | null;
  status: string;
  error?: string | null;
  createdAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
}

export function isGarmentCategory(v: unknown): v is GarmentCategory {
  return typeof v === "string" && (GARMENT_CATEGORIES as readonly string[]).includes(v);
}

export function isGarmentView(v: unknown): v is GarmentView {
  return v === "flat" || v === "on-model";
}

/**
 * Parse color tags from a JSON array, a JSON-array string, or a comma-separated
 * string. Non-strings are dropped, tags are trimmed, truncated to 32 chars,
 * de-duplicated case-insensitively, and capped at 12.
 */
export function parseColorTags(raw: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        items = Array.isArray(parsed) ? parsed : trimmed.split(",");
      } catch {
        items = trimmed.split(",");
      }
    } else {
      items = trimmed.split(",");
    }
  } else {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, MAX_COLOR_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_COLOR_TAGS) break;
  }
  return out;
}

/** Convert a drizzle timestamp (Date | unix seconds | ms | ISO string) to ISO-8601. */
export function toIsoString(value: Date | string | number | null | undefined): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Map a stored uploads-relative path (or an already-public `/api/files/...` URL)
 * to the public files URL.
 */
export function storedPathToUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const s = stored.replace(/\\/g, "/");
  if (s.startsWith("/api/files/")) return s;
  const rel = s.replace(/^\/+/, "").replace(/^uploads\//, "");
  if (!rel) return null;
  return `/api/files/${rel}`;
}

/** Keep items that exist, in `ids` order; missing ids are skipped. */
export function pickByIds<T extends { id: string }>(ids: readonly string[], items: readonly T[]): T[] {
  const map = new Map(items.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const id of ids) {
    const item = map.get(id);
    if (item) out.push(item);
  }
  return out;
}

export function toGarmentDto(row: GarmentRow): GarmentDto {
  const category: GarmentCategory = isGarmentCategory(row.category) ? row.category : "tops";
  const view: GarmentView = isGarmentView(row.view) ? row.view : "flat";
  return {
    id: row.id,
    name: row.name,
    category,
    view,
    frontUrl: storedPathToUrl(row.frontPath) ?? "",
    backUrl: storedPathToUrl(row.backPath),
    colorTags: Array.isArray(row.colorTags) ? row.colorTags : [],
    notes: row.notes ?? null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toGarmentSetDto(row: GarmentSetRow, garments: GarmentDto[]): GarmentSetDto {
  return {
    id: row.id,
    name: row.name,
    garmentIds: Array.isArray(row.garmentIds) ? row.garmentIds : [],
    characterId: row.characterId ?? null,
    garments,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toLookDto(row: LookRow): LookDto {
  const route: TryOnRouteId = row.route === "vton" ? "vton" : "compose";
  return {
    id: row.id,
    garmentSetId: row.garmentSetId,
    characterId: row.characterId,
    characterSnapshot: row.characterSnapshot ?? null,
    poseId: row.poseId,
    lookPresetId: row.lookPresetId ?? null,
    route,
    provider: row.provider ?? null,
    model: row.model ?? null,
    imageUrl: storedPathToUrl(row.imagePath),
    score: row.score ?? null,
    status: row.status,
    error: row.error ?? null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function clipText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
