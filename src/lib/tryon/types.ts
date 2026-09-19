/**
 * Try-on (Look) engine — shared types.
 *
 * A Look is one still of a presenter wearing a garment set in one preset pose.
 * Generation is routed through a `TryOnRoute`:
 *  - "compose": one multi-reference image edit (model sheet + garment photos in a
 *    single call) via the existing AIProvider layer — no new dependency.
 *  - "vton":    a dedicated virtual try-on model (FASHN) applied garment by garment.
 *
 * These types are pure and dependency-free so the engine can be lifted out later.
 */
import type { GarmentCategory, PosePreset } from "@/lib/pose-presets";
import type { ProviderConfig } from "@/lib/providers/types";

export type { GarmentCategory } from "@/lib/pose-presets";

export type TryOnRouteId = "compose" | "vton";
export const TRYON_ROUTE_IDS: readonly TryOnRouteId[] = ["compose", "vton"];
export const DEFAULT_TRYON_ROUTE: TryOnRouteId = "compose";

/** How a garment reference photo was shot. */
export type GarmentView = "flat" | "on-model";

export interface LookGarmentInput {
  /** Publicly fetchable URL or data URL of the garment reference (front view) */
  url: string;
  category: GarmentCategory;
  view: GarmentView;
  /** Free-text notes the user wants preserved (fabric, cut, pattern to keep) */
  notes?: string;
  /** Optional back-view reference */
  backUrl?: string;
}

export interface LookLock {
  /** Keep the presenter's face / hair identical to the reference sheet */
  face: boolean;
  /** Keep garment colour, pattern and cut identical to the garment photos */
  garmentPattern: boolean;
}

export interface LookRequest {
  /** Presenter references — the 2x2 character sheet first, then any extra reference photos */
  modelRefs: string[];
  /** Appearance text for the presenter (fallback anchor when no sheet exists; also picks the prompt language) */
  modelAppearance?: string;
  /** Garments ordered inner → outer (the order they are worn) */
  garments: LookGarmentInput[];
  pose: PosePreset;
  /** look-presets id for lighting / backdrop; omitted → neutral studio */
  lookPresetId?: string;
  aspect: "3:4" | "9:16";
  lock: LookLock;
  /** Prompt language; omitted → inferred from garment notes / appearance text */
  lang?: "zh" | "en";
}

export interface LookResult {
  imageUrl: string;
  provider: string;
  model: string;
  prompt: string;
  /** Provider task id when the route submits an async job */
  taskId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Presenter facts the client sends with a Look request (presenters live in the client
 * character store, not the DB) and that the server freezes onto the Look row.
 */
export interface LookCharacterSnapshot {
  id: string;
  name: string;
  appearance?: string;
  /** Character sheet / reference photo URLs (server-resolvable: /api/files/... or absolute) */
  referenceImages: string[];
}

/** Vision-LLM quality score for one Look. All axes 0–5; higher is better (incl. `artifact`). */
export interface LookScore {
  /** Garment colour / pattern / cut fidelity to the garment reference */
  garment: number;
  /** Pose matches the preset description */
  pose: number;
  /** Face / hair identity matches the presenter reference */
  identity: number;
  /** Freedom from artifacts (extra fingers, warped seams, text) */
  artifact: number;
  /** Weighted overall, or null when the evaluator output could not be parsed */
  overall: number | null;
  reasons: string[];
  evaluatorModel?: string;
}

export interface TryOnRouteContext {
  providerConfig: ProviderConfig;
  /** Image model id to use on the provider (compose route) */
  modelId?: string;
  /** Route-specific settings (e.g. FASHN base URL) */
  settings?: Record<string, unknown>;
}

export interface TryOnRoute {
  readonly id: TryOnRouteId;
  readonly displayName: { zh: string; en: string };
  /** Whether this route can dress the given garment categories */
  supports(categories: readonly GarmentCategory[]): boolean;
  generateLook(req: LookRequest, ctx: TryOnRouteContext): Promise<LookResult>;
}

/** Error raised by a route; carries enough context for the API layer to build a friendly message. */
export class TryOnRouteError extends Error {
  readonly route: TryOnRouteId;
  readonly poseId: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(input: { route: TryOnRouteId; poseId: string; message: string; retryable?: boolean; cause?: unknown }) {
    super(input.message);
    this.name = "TryOnRouteError";
    this.route = input.route;
    this.poseId = input.poseId;
    this.retryable = input.retryable ?? false;
    this.cause = input.cause;
  }
}

/** Upper bound on garments per Look (compose route reference-image budget). */
export const MAX_GARMENTS_PER_LOOK = 5;
/** Upper bound on poses per generate request. */
export const MAX_POSES_PER_REQUEST = 8;
