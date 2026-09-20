import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { fashnRoute, unsupportedFashnCategories } from "@/lib/tryon/fashn-route";
import {
  generateLooksInBackground,
  loadOrderedGarments,
  parseCharacter,
  parseLlmConfig,
  parseLock,
  parseTryonBody,
  type LookJobConfig,
} from "@/lib/tryon/run-look";
import { getPosePreset, isPoseId } from "@/lib/pose-presets";
import {
  DEFAULT_TRYON_ROUTE,
  MAX_GARMENTS_PER_LOOK,
  MAX_POSES_PER_REQUEST,
  TRYON_ROUTE_IDS,
  type TryOnRouteId,
} from "@/lib/tryon/types";

/**
 * POST /api/looks/generate — insert one pending Look per pose, return 202 { lookIds },
 * then generate (and optionally score) in the background (concurrency 3).
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

    const lookPresetId =
      typeof body.lookPresetId === "string" && body.lookPresetId.trim() ? body.lookPresetId.trim() : undefined;

    const lock = parseLock(body.lock);
    const lang = body.lang === "en" || body.lang === "zh" ? body.lang : undefined;
    const llmConfig = parseLlmConfig(body.llmConfig);
    const fashn = parseTryonBody(body.tryon);

    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (route !== "vton") {
      if (!provider || !model) {
        return apiError(req, "缺少 provider / model", "Missing provider / model", 400);
      }
      if (typeof body.apiKey !== "string" || !body.apiKey) {
        return apiError(
          req,
          "缺少 API Key，请先在设置中配置生图平台",
          "Missing API key — configure an image provider in settings first",
          400
        );
      }
    } else if (!fashn.apiKey) {
      return apiError(
        req,
        "请先在设置中配置 FASHN API Key",
        "Configure the FASHN API key in settings first",
        400
      );
    }
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
    const options =
      body.options && typeof body.options === "object" && !Array.isArray(body.options)
        ? (body.options as Record<string, unknown>)
        : {};

    const loaded = await loadOrderedGarments(garmentSetId);
    if (!loaded) return apiError(req, "服装搭配不存在", "Garment set not found", 400);
    const garmentIds = loaded.set.garmentIds ?? [];
    if (garmentIds.length > MAX_GARMENTS_PER_LOOK) {
      return apiError(
        req,
        `单次 Look 最多 ${MAX_GARMENTS_PER_LOOK} 件服装`,
        `A look can include at most ${MAX_GARMENTS_PER_LOOK} garments`,
        400
      );
    }
    if (loaded.garments.length < 1) {
      return apiError(req, "该搭配没有服装", "Garment set has no garments", 400);
    }

    if (route === "vton") {
      const categories = loaded.garments.map((g) => g.category);
      if (!fashnRoute.supports(categories)) {
        const names = unsupportedFashnCategories(categories).join("、") || categories.join("、");
        return apiError(
          req,
          `FASHN 不支持 ${names} 类目，请改用 compose 或去掉鞋履/配饰`,
          `FASHN does not support ${names}; switch to compose or drop shoes/accessories`,
          400
        );
      }
    }

    const db = getDb();
    const inserted: { id: string; poseId: string }[] = [];
    for (const poseId of poseIds) {
      if (!getPosePreset(poseId)) {
        return apiError(req, "包含未知的姿态 ID", "One or more pose ids are invalid", 400);
      }
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

    const job: LookJobConfig = {
      garmentSetId,
      character,
      lookPresetId,
      route,
      lock,
      lang,
      provider: provider || "fashn",
      model: model || "tryon-v1.6",
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      baseUrl,
      options,
      llmConfig,
      fashn: route === "vton" ? { apiKey: fashn.apiKey, baseUrl: fashn.baseUrl } : undefined,
    };

    void generateLooksInBackground(inserted, job, loaded.garments).catch((err) => {
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
