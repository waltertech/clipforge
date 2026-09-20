import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { getPosePreset, isPoseId } from "@/lib/pose-presets";
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
import {
  DEFAULT_TRYON_ROUTE,
  MAX_GARMENTS_PER_LOOK,
  TRYON_ROUTE_IDS,
  type LookCharacterSnapshot,
  type TryOnRouteId,
} from "@/lib/tryon/types";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

/**
 * POST /api/looks/[id]/retry — clone the source Look into a NEW pending row
 * (never overwrites) and run the same background generation + scoring as generate.
 * 202 { lookId }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的 Look ID", "Invalid look id", 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }

    const db = getDb();
    const [source] = await db.select().from(looks).where(eq(looks.id, id)).limit(1);
    if (!source) return apiError(req, "Look 不存在", "Look not found", 404);

    const character: LookCharacterSnapshot | null = parseCharacter(source.characterSnapshot) ?? parseCharacter(body.character);
    if (!character) {
      return apiError(
        req,
        "源 Look 缺少模特快照，无法重试",
        "Source look has no character snapshot to retry with",
        400
      );
    }

    let poseId = source.poseId;
    if (body.poseId != null && body.poseId !== "") {
      if (typeof body.poseId !== "string" || !isPoseId(body.poseId) || !getPosePreset(body.poseId)) {
        return apiError(req, "未知的姿态 ID", "Unknown pose id", 400);
      }
      poseId = body.poseId;
    }

    let route: TryOnRouteId = source.route === "vton" ? "vton" : DEFAULT_TRYON_ROUTE;
    if (body.route != null && body.route !== "") {
      if (typeof body.route !== "string" || !(TRYON_ROUTE_IDS as readonly string[]).includes(body.route)) {
        return apiError(req, "未知的试衣路线，仅支持 compose 或 vton", "Unknown try-on route; use compose or vton", 400);
      }
      route = body.route as TryOnRouteId;
    }

    const lookPresetId =
      typeof body.lookPresetId === "string"
        ? body.lookPresetId.trim() || undefined
        : source.lookPresetId ?? undefined;

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

    const loaded = await loadOrderedGarments(source.garmentSetId);
    if (!loaded) return apiError(req, "服装搭配不存在", "Garment set not found", 400);
    if ((loaded.set.garmentIds ?? []).length > MAX_GARMENTS_PER_LOOK) {
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

    const [row] = await db
      .insert(looks)
      .values({
        garmentSetId: source.garmentSetId,
        characterId: character.id,
        characterSnapshot: character,
        poseId,
        lookPresetId: lookPresetId ?? null,
        route,
        status: "pending",
      })
      .returning({ id: looks.id, poseId: looks.poseId });
    if (!row) {
      return apiError(req, "无法创建重试任务", "Failed to create retry look", 500);
    }

    const options =
      body.options && typeof body.options === "object" && !Array.isArray(body.options)
        ? (body.options as Record<string, unknown>)
        : {};

    const job: LookJobConfig = {
      garmentSetId: source.garmentSetId,
      character,
      lookPresetId,
      route,
      lock,
      lang,
      provider: provider || "fashn",
      model: model || "tryon-v1.6",
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      options,
      llmConfig,
      fashn: route === "vton" ? { apiKey: fashn.apiKey, baseUrl: fashn.baseUrl } : undefined,
    };

    void generateLooksInBackground([row], job, loaded.garments).catch((err) => {
      console.error("Look 重试后台生成失败:", err);
    });

    return NextResponse.json({ lookId: row.id }, { status: 202 });
  } catch (error) {
    console.error("重试 Look 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "重试 Look 失败", "Failed to retry look") },
      { status: 500 }
    );
  }
}
