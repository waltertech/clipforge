import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garments, garmentSets, looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import { mapWithConcurrency } from "@/lib/concurrency";
import { friendlyError } from "@/lib/friendly-error";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { getPosePreset, isPoseId } from "@/lib/pose-presets";
import { getTryOnRoute } from "@/lib/tryon";
import { persistImageSource, uploadsSubdir } from "@/lib/tryon/storage";
import {
  DEFAULT_TRYON_ROUTE,
  MAX_GARMENTS_PER_LOOK,
  MAX_POSES_PER_REQUEST,
  TRYON_ROUTE_IDS,
  TryOnRouteError,
  type LookCharacterSnapshot,
  type LookRequest,
  type TryOnRouteId,
} from "@/lib/tryon/types";
import { isGarmentCategory, isGarmentView, pickByIds, storedPathToUrl } from "@/lib/garments";

const LOOK_CONCURRENCY = 3;

function parseCharacter(raw: unknown): LookCharacterSnapshot | null {
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

async function remoteUrl(ref: string | null | undefined): Promise<string | undefined> {
  const publicUrl = ref?.startsWith("/api/files/") || ref?.startsWith("http") || ref?.startsWith("data:")
    ? ref
    : storedPathToUrl(ref);
  if (!publicUrl) return undefined;
  return toRemoteUsableImage(publicUrl);
}

type GenerateBody = {
  garmentSetId: string;
  character: LookCharacterSnapshot;
  poseIds: string[];
  lookPresetId?: string;
  route: TryOnRouteId;
  lock: { face: boolean; garmentPattern: boolean };
  lang?: "zh" | "en";
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  options: Record<string, unknown>;
};

/**
 * POST /api/looks/generate — insert one pending Look per pose, return 202 { lookIds },
 * then generate in the background (concurrency 3). One pose failing never aborts the rest.
 */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }

    const garmentSetId = typeof body.garmentSetId === "string" ? body.garmentSetId.trim() : "";
    if (!garmentSetId) {
      return apiError(req, "缺少 garmentSetId", "Missing garmentSetId", 400);
    }

    const character = parseCharacter(body.character);
    if (!character) {
      return apiError(
        req,
        "缺少有效的模特信息（需要 id、name、referenceImages）",
        "Missing valid character snapshot (id, name, referenceImages required)",
        400
      );
    }

    if (!Array.isArray(body.poseIds) || body.poseIds.length < 1) {
      return apiError(req, "请至少选择一个姿态", "Select at least one pose", 400);
    }
    if (body.poseIds.length > MAX_POSES_PER_REQUEST) {
      return apiError(
        req,
        `一次最多生成 ${MAX_POSES_PER_REQUEST} 个姿态`,
        `At most ${MAX_POSES_PER_REQUEST} poses per request`,
        400
      );
    }
    if (!body.poseIds.every((id) => isPoseId(id))) {
      return apiError(req, "包含未知的姿态 ID", "One or more pose ids are invalid", 400);
    }
    const poseIds = body.poseIds as string[];

    let route: TryOnRouteId = DEFAULT_TRYON_ROUTE;
    if (body.route != null && body.route !== "") {
      if (typeof body.route !== "string" || !(TRYON_ROUTE_IDS as readonly string[]).includes(body.route)) {
        return apiError(req, "未知的试衣路线，仅支持 compose 或 vton", "Unknown try-on route; use compose or vton", 400);
      }
      route = body.route as TryOnRouteId;
    }

    const lookPresetId = typeof body.lookPresetId === "string" && body.lookPresetId.trim()
      ? body.lookPresetId.trim()
      : undefined;

    const lockRaw = body.lock && typeof body.lock === "object" && !Array.isArray(body.lock)
      ? (body.lock as Record<string, unknown>)
      : {};
    const lock = {
      face: lockRaw.face !== false,
      garmentPattern: lockRaw.garmentPattern !== false,
    };

    const lang = body.lang === "en" || body.lang === "zh" ? body.lang : undefined;

    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!provider || !model) {
      return apiError(req, "缺少 provider / model", "Missing provider / model", 400);
    }
    if (typeof body.apiKey !== "string" || !body.apiKey) {
      return apiError(req, "缺少 API Key，请先在设置中配置生图平台", "Missing API key — configure an image provider in settings first", 400);
    }
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
    const options =
      body.options && typeof body.options === "object" && !Array.isArray(body.options)
        ? (body.options as Record<string, unknown>)
        : {};

    const db = getDb();
    const [set] = await db.select().from(garmentSets).where(eq(garmentSets.id, garmentSetId)).limit(1);
    if (!set) return apiError(req, "服装搭配不存在", "Garment set not found", 400);

    const garmentIds = set.garmentIds ?? [];
    if (garmentIds.length > MAX_GARMENTS_PER_LOOK) {
      return apiError(
        req,
        `单次 Look 最多 ${MAX_GARMENTS_PER_LOOK} 件服装`,
        `A look can include at most ${MAX_GARMENTS_PER_LOOK} garments`,
        400
      );
    }
    if (garmentIds.length < 1) {
      return apiError(req, "该搭配没有服装", "Garment set has no garments", 400);
    }

    const garmentRows = await db.select().from(garments).where(inArray(garments.id, garmentIds));
    const orderedGarments = pickByIds(garmentIds, garmentRows);
    if (orderedGarments.length < 1) {
      return apiError(req, "搭配中的服装已不存在", "Garments in the set no longer exist", 400);
    }

    const inserted: { id: string; poseId: string }[] = [];
    for (const poseId of poseIds) {
      const [row] = await db
        .insert(looks)
        .values({
          garmentSetId,
          characterId: character.id,
          characterSnapshot: character,
          poseId,
          lookPresetId: lookPresetId ?? null,
          route,
          status: "pending",
        })
        .returning({ id: looks.id, poseId: looks.poseId });
      if (row) inserted.push(row);
    }

    const job: GenerateBody = {
      garmentSetId,
      character,
      poseIds,
      lookPresetId,
      route,
      lock,
      lang,
      provider,
      model,
      apiKey: body.apiKey,
      baseUrl,
      options,
    };

    void generateLooksInBackground(inserted, job, orderedGarments).catch((err) => {
      console.error("Look 后台生成失败:", err);
    });

    return NextResponse.json({ lookIds: inserted.map((r) => r.id) }, { status: 202 });
  } catch (error) {
    console.error("创建 Look 生成任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "创建 Look 生成任务失败", "Failed to start look generation") },
      { status: 500 }
    );
  }
}

async function markLookFailed(lookId: string, message: string, aiTaskRowId: string | null): Promise<void> {
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

async function generateLooksInBackground(
  inserted: { id: string; poseId: string }[],
  job: GenerateBody,
  garmentRows: Array<{
    frontPath: string;
    backPath: string | null;
    category: string;
    view: string;
    notes: string | null;
  }>
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
      // mapWithConcurrency rejects the whole batch on throw — never let one pose abort the rest
      console.error(`Look ${item.id} 生成失败:`, err);
      await markLookFailed(item.id, friendlyError(err, "zh"), null);
    }
  });
}

async function generateOneLook(
  item: { id: string; poseId: string },
  job: GenerateBody,
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
      settings: job.options,
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

    await updateAiTask(aiTaskRowId, {
      status: "completed",
      resultUrls: [`/api/files/${imagePath}`],
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
