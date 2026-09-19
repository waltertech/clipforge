/**
 * Shared Look generation + scoring used by POST /api/looks/generate and
 * POST /api/looks/[id]/retry. Lives next to the try-on engine so both routes
 * stay thin; DB I/O is intentional here (the route handlers own persistence).
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garments, garmentSets, looks } from "@/lib/db/schema";
import { recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import { mapWithConcurrency } from "@/lib/concurrency";
import { friendlyError } from "@/lib/friendly-error";
import { isGarmentCategory, isGarmentView, pickByIds, storedPathToUrl } from "@/lib/garments";
import { getPosePreset } from "@/lib/pose-presets";
import { toRemoteUsableImage } from "@/lib/remote-image";
import type { LLMConfig } from "@/lib/script-engine/generator";
import { getTryOnRoute } from "@/lib/tryon";
import { scoreLook } from "@/lib/tryon/score";
import { persistImageSource, uploadsSubdir } from "@/lib/tryon/storage";
import {
  TryOnRouteError,
  type LookCharacterSnapshot,
  type LookRequest,
  type LookScore,
  type TryOnRouteId,
} from "@/lib/tryon/types";

export const LOOK_CONCURRENCY = 3;

export type LookJobConfig = {
  garmentSetId: string;
  character: LookCharacterSnapshot;
  lookPresetId?: string;
  route: TryOnRouteId;
  lock: { face: boolean; garmentPattern: boolean };
  lang?: "zh" | "en";
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  options: Record<string, unknown>;
  llmConfig?: LLMConfig | null;
  fashn?: { apiKey: string; baseUrl?: string };
};

export type GarmentLookRow = {
  frontPath: string;
  backPath: string | null;
  category: string;
  view: string;
  notes: string | null;
};

export function parseLlmConfig(raw: unknown): LLMConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.baseUrl !== "string" || !o.baseUrl.trim()) return null;
  if (typeof o.model !== "string" || !o.model.trim()) return null;
  return {
    baseUrl: o.baseUrl.trim(),
    apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
    model: o.model.trim(),
    ...(typeof o.visionModel === "string" && o.visionModel.trim()
      ? { visionModel: o.visionModel.trim() }
      : {}),
  };
}

export function parseTryonBody(raw: unknown): { apiKey: string; baseUrl?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { apiKey: "" };
  const o = raw as Record<string, unknown>;
  const apiKey = typeof o.fashnApiKey === "string" ? o.fashnApiKey.trim() : "";
  const baseUrl = typeof o.fashnBaseUrl === "string" && o.fashnBaseUrl.trim() ? o.fashnBaseUrl.trim() : undefined;
  return { apiKey, ...(baseUrl ? { baseUrl } : {}) };
}

export function parseLock(raw: unknown): { face: boolean; garmentPattern: boolean } {
  const lockRaw = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    face: lockRaw.face !== false,
    garmentPattern: lockRaw.garmentPattern !== false,
  };
}

export function parseCharacter(raw: unknown): LookCharacterSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  if (o.appearance != null && typeof o.appearance !== "string") return null;
  if (!Array.isArray(o.referenceImages) || !o.referenceImages.every((u) => typeof u === "string")) return null;
  return {
    id: o.id.trim(),
    name: o.name.trim(),
    ...(typeof o.appearance === "string" ? { appearance: o.appearance } : {}),
    referenceImages: o.referenceImages as string[],
  };
}

export function tryonSettings(job: LookJobConfig): Record<string, unknown> {
  return {
    ...job.options,
    ...(job.fashn ? { fashn: job.fashn } : {}),
  };
}

async function remoteUrl(ref: string | null | undefined): Promise<string | undefined> {
  const publicUrl =
    ref?.startsWith("/api/files/") || ref?.startsWith("http") || ref?.startsWith("data:")
      ? ref
      : storedPathToUrl(ref);
  if (!publicUrl) return undefined;
  return toRemoteUsableImage(publicUrl);
}

export async function loadOrderedGarments(garmentSetId: string): Promise<{
  set: typeof garmentSets.$inferSelect;
  garments: Array<typeof garments.$inferSelect>;
} | null> {
  const db = getDb();
  const [set] = await db.select().from(garmentSets).where(eq(garmentSets.id, garmentSetId)).limit(1);
  if (!set) return null;
  const ids = set.garmentIds ?? [];
  if (ids.length < 1) return { set, garments: [] };
  const rows = await db.select().from(garments).where(inArray(garments.id, ids));
  return { set, garments: pickByIds(ids, rows) };
}

export async function markLookFailed(lookId: string, message: string, aiTaskRowId: string | null): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(looks)
      .set({ status: "failed", error: message, aiTaskId: aiTaskRowId, updatedAt: new Date() })
      .where(eq(looks.id, lookId));
  } catch (err) {
    console.error("Look 失败状态写入失败:", err);
  }
}

async function maybeScoreLook(
  lookId: string,
  job: LookJobConfig,
  imageUrl: string,
  modelRefs: string[],
  lookGarments: LookRequest["garments"],
  poseDescription: string
): Promise<LookScore | null> {
  const config = job.llmConfig;
  if (!config?.baseUrl || !config.model) return null;
  try {
    const score = await scoreLook({
      lookImageUrl: imageUrl,
      modelRefUrl: modelRefs[0],
      garmentUrls: lookGarments.map((g) => g.url),
      poseDescription,
      garmentNotes: lookGarments
        .map((g) => g.notes)
        .filter((n): n is string => Boolean(n))
        .join("; "),
      locale: job.lang === "en" ? "en" : "zh",
      config,
    });
    const db = getDb();
    await db.update(looks).set({ score, updatedAt: new Date() }).where(eq(looks.id, lookId));
    return score;
  } catch (err) {
    console.error(`Look ${lookId} 打分失败:`, err);
    return null;
  }
}

export async function scoreExistingLook(input: {
  lookId: string;
  imageUrl: string;
  modelRefUrl?: string;
  garmentUrls: string[];
  poseDescription: string;
  garmentNotes?: string;
  locale: "zh" | "en";
  config: LLMConfig;
}): Promise<LookScore> {
  const score = await scoreLook({
    lookImageUrl: input.imageUrl,
    modelRefUrl: input.modelRefUrl,
    garmentUrls: input.garmentUrls,
    poseDescription: input.poseDescription,
    garmentNotes: input.garmentNotes,
    locale: input.locale,
    config: input.config,
  });
  const db = getDb();
  await db.update(looks).set({ score, updatedAt: new Date() }).where(eq(looks.id, input.lookId));
  return score;
}

async function generateOneLook(
  item: { id: string; poseId: string },
  job: LookJobConfig,
  modelRefs: string[],
  lookGarments: LookRequest["garments"]
): Promise<void> {
  const db = getDb();
  const pose = getPosePreset(item.poseId);
  if (!pose) {
    await db
      .update(looks)
      .set({ status: "failed", error: "未知姿态", updatedAt: new Date() })
      .where(eq(looks.id, item.id));
    return;
  }

  await db.update(looks).set({ status: "generating", updatedAt: new Date() }).where(eq(looks.id, item.id));

  const lookReq: LookRequest = {
    modelRefs,
    modelAppearance: job.character.appearance,
    garments: lookGarments,
    pose,
    lookPresetId: job.lookPresetId,
    aspect: pose.aspect,
    lock: job.lock,
    lang: job.lang,
  };

  let aiTaskRowId: string | null = null;
  try {
    const result = await getTryOnRoute(job.route).generateLook(lookReq, {
      providerConfig: { name: job.provider, apiKey: job.apiKey, baseUrl: job.baseUrl },
      modelId: job.model,
      settings: tryonSettings(job),
    });

    aiTaskRowId = await recordAiTask({
      provider: result.provider,
      model: result.model,
      mediaType: "image",
      mode: "look",
      prompt: result.prompt,
      taskId: result.taskId ?? item.id,
    });

    const dir = await uploadsSubdir("looks", job.garmentSetId);
    const saved = await persistImageSource(result.imageUrl, dir, item.id);
    const imagePath = `looks/${job.garmentSetId}/${saved.fileName}`;
    const imageUrl = `/api/files/${imagePath}`;

    await updateAiTask(aiTaskRowId, {
      status: "completed",
      resultUrls: [imageUrl],
      error: null,
    });

    await db
      .update(looks)
      .set({
        imagePath,
        provider: result.provider,
        model: result.model,
        prompt: result.prompt,
        status: "candidate",
        aiTaskId: aiTaskRowId,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(looks.id, item.id));

    await maybeScoreLook(
      item.id,
      job,
      imageUrl,
      modelRefs,
      lookGarments,
      pose.prompt[job.lang === "en" ? "en" : "zh"]
    );
  } catch (err) {
    const message = err instanceof TryOnRouteError ? err.message : friendlyError(err, "zh");
    if (!aiTaskRowId) {
      aiTaskRowId = await recordAiTask({
        provider: job.provider,
        model: job.model,
        mediaType: "image",
        mode: "look",
        taskId: item.id,
      });
    }
    await updateAiTask(aiTaskRowId, { status: "failed", error: message });
    await markLookFailed(item.id, message, aiTaskRowId);
  }
}

export async function generateLooksInBackground(
  inserted: { id: string; poseId: string }[],
  job: LookJobConfig,
  garmentRows: GarmentLookRow[]
): Promise<void> {
  let modelRefs: string[] = [];
  const lookGarments: LookRequest["garments"] = [];
  try {
    modelRefs = (await Promise.all(job.character.referenceImages.map((u) => remoteUrl(u)))).filter(
      (u): u is string => !!u
    );
    for (const g of garmentRows) {
      const url = await remoteUrl(storedPathToUrl(g.frontPath) ?? g.frontPath);
      if (!url) continue;
      const back = g.backPath ? await remoteUrl(storedPathToUrl(g.backPath) ?? g.backPath) : undefined;
      lookGarments.push({
        url,
        category: isGarmentCategory(g.category) ? g.category : "tops",
        view: isGarmentView(g.view) ? g.view : "flat",
        ...(g.notes ? { notes: g.notes } : {}),
        ...(back ? { backUrl: back } : {}),
      });
    }
  } catch (err) {
    const message = friendlyError(err, "zh");
    await Promise.all(inserted.map((item) => markLookFailed(item.id, message, null)));
    return;
  }

  await mapWithConcurrency(inserted, LOOK_CONCURRENCY, async (item) => {
    try {
      await generateOneLook(item, job, modelRefs, lookGarments);
    } catch (err) {
      console.error(`Look ${item.id} 生成失败:`, err);
      await markLookFailed(item.id, friendlyError(err, "zh"), null);
    }
  });
}
