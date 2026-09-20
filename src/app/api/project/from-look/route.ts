import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  projects,
  scripts as scriptsTable,
  assets,
  looks,
  garments,
  garmentSets,
  adTemplateRecipes,
} from "@/lib/db/schema";
import type { AdTemplate } from "@/lib/ad-templates";
import {
  getAdTemplate,
  isFashionTemplate,
  encodeStoredAdTemplate,
} from "@/lib/ad-templates";
import { persistAssetSource } from "@/lib/asset-persistence";
import { apiError, errText, pickLocale } from "@/lib/api-error";
import { missingPosesFor, MissingLooksError, type FashionLookInput } from "@/lib/fashion-shots";
import { pickByIds, toGarmentDto, toLookDto } from "@/lib/garments";
import { planFromLook } from "@/lib/from-look-plan";
import { getPosePreset } from "@/lib/pose-presets";

const VIDEO_MODES = ["product_closeup", "graphic_montage", "scene_demo", "live_presenter"] as const;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function resolveFashionTemplate(templateId: string): Promise<AdTemplate | undefined> {
  const builtin = getAdTemplate(templateId);
  if (builtin) return builtin;
  const db = getDb();
  const [row] = await db.select().from(adTemplateRecipes).where(eq(adTemplateRecipes.id, templateId)).limit(1);
  if (!row) return undefined;
  const recipe = row.recipe as AdTemplate;
  return { ...recipe, id: row.id };
}

/**
 * POST /api/project/from-look
 *
 * Body: { garmentSetId, templateId, character, name?, lang?, llmConfig? }
 * Creates a project + selected script + look keyframe assets from a fashion template.
 * Does not call a storyboard LLM. Voiceover is left empty (voiceoverPending when the
 * template wants lines) so shot count stays fixed.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError(req, "请求体不是合法 JSON", "Request body is not valid JSON", 400);
  }

  const garmentSetId = asString(body.garmentSetId);
  const templateId = asString(body.templateId);
  if (!garmentSetId) return apiError(req, "缺少 garmentSetId", "Missing garmentSetId", 400);
  if (!templateId) return apiError(req, "缺少 templateId", "Missing templateId", 400);

  const rawCharacter = body.character;
  if (!rawCharacter || typeof rawCharacter !== "object") {
    return apiError(req, "缺少 character", "Missing character", 400);
  }
  const c = rawCharacter as Record<string, unknown>;
  const characterId = asString(c.id);
  const characterName = asString(c.name);
  if (!characterId || !characterName) {
    return apiError(req, "character 需要 id 和 name", "character requires id and name", 400);
  }
  const referenceImages = Array.isArray(c.referenceImages)
    ? c.referenceImages.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  const character = {
    id: characterId,
    name: characterName,
    appearance: typeof c.appearance === "string" ? c.appearance : undefined,
    referenceImages,
  };

  const lang = body.lang === "en" || body.lang === "zh" ? body.lang : pickLocale(req);

  let template: AdTemplate | undefined;
  try {
    template = await resolveFashionTemplate(templateId);
  } catch (error) {
    console.error("读取时装模板失败:", error);
    return apiError(req, "读取模板失败", "Failed to load template", 500);
  }
  if (!template) return apiError(req, "模板不存在", "Template not found", 404);
  if (!isFashionTemplate(template)) {
    return apiError(req, "该模板不是时装模板", "Template is not a fashion template", 400);
  }

  const db = getDb();
  const [setRow] = await db.select().from(garmentSets).where(eq(garmentSets.id, garmentSetId)).limit(1);
  if (!setRow) return apiError(req, "服装搭配不存在", "Garment set not found", 404);

  const setIds = Array.isArray(setRow.garmentIds) ? setRow.garmentIds : [];
  const garmentRows = setIds.length ? await db.select().from(garments).where(inArray(garments.id, setIds)) : [];
  const garmentDtos = pickByIds(setIds, garmentRows).map(toGarmentDto);

  const lookRows = await db.select().from(looks).where(eq(looks.garmentSetId, garmentSetId));
  const fashionLooks: FashionLookInput[] = lookRows.map((row) => {
    const dto = toLookDto(row);
    return { poseId: row.poseId, imageUrl: dto.imageUrl ?? "", status: row.status };
  });

  if (template.fashion.lookSource !== "grid") {
    const missingPoses = missingPosesFor(template, fashionLooks);
    if (missingPoses.length > 0) {
      const labels = missingPoses.map((id) => getPosePreset(id)?.name[lang] ?? id);
      return NextResponse.json(
        {
          error: errText(
            req,
            `缺少已验收 Look：${labels.join("、")}`,
            `Missing accepted Looks for poses: ${labels.join(", ")}`
          ),
          missingPoses,
        },
        { status: 409 }
      );
    }
  }

  let plan;
  try {
    plan = planFromLook({
      template,
      looks: fashionLooks,
      garmentSet: { name: setRow.name, garments: garmentDtos.map((g) => ({ name: g.name, frontUrl: g.frontUrl })) },
      character,
      lang,
    });
  } catch (error) {
    if (error instanceof MissingLooksError) {
      return NextResponse.json(
        {
          error: errText(
            req,
            `缺少已验收 Look：${error.missingPoses.join("、")}`,
            `Missing accepted Looks for poses: ${error.missingPoses.join(", ")}`
          ),
          missingPoses: error.missingPoses,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  const projectName = asString(body.name) || plan.projectFields.name;
  const videoMode = VIDEO_MODES.includes(plan.projectFields.videoMode) ? plan.projectFields.videoMode : undefined;
  const garmentImageUrl = plan.projectFields.productImages[0];

  try {
    const [created] = await db
      .insert(projects)
      .values({
        name: projectName || "未命名项目",
        productName: plan.projectFields.productName,
        productCategory: plan.projectFields.productCategory,
        productDescription: plan.projectFields.productDescription,
        productImages: plan.projectFields.productImages,
        status: "assets",
        characterId: character.id,
        fashionSource: {
          garmentSetId,
          templateId,
          characterId: character.id,
          ...(garmentImageUrl && { garmentImageUrl }),
        },
        ...(videoMode && { videoMode }),
      })
      .returning();

    await db.insert(scriptsTable).values({
      projectId: created.id,
      version: 1,
      styleType: plan.scriptFields.styleType,
      title: plan.scriptFields.title,
      totalDuration: plan.scriptFields.totalDuration,
      shots: plan.scriptFields.shots,
      characters: plan.scriptFields.characters,
      selected: true,
    });

    const lookByUrl = new Map(
      lookRows
        .map((row) => {
          const url = toLookDto(row).imageUrl;
          return url ? ([url, row] as const) : null;
        })
        .filter((entry): entry is readonly [string, (typeof lookRows)[number]] => entry !== null)
    );

    for (const [shotIdKey, imageUrl] of Object.entries(plan.keyframes)) {
      if (!imageUrl) continue;
      const shotId = Number(shotIdKey);
      if (!Number.isFinite(shotId)) continue;
      const lookRow = lookByUrl.get(imageUrl);
      let filePath = imageUrl;
      try {
        filePath = await persistAssetSource(created.id, imageUrl, shotId);
      } catch (error) {
        console.warn("Look 素材落盘失败，回退原始路径:", error);
      }
      await db.insert(assets).values({
        projectId: created.id,
        shotId,
        type: "look",
        filePath,
        provider: lookRow?.provider ?? undefined,
        model: lookRow?.model ?? undefined,
        prompt: lookRow?.prompt ?? undefined,
        selected: true,
        status: "done",
      });
    }

    const voiceoverPending = template.fashion.scriptPattern !== "none";

    return NextResponse.json(
      {
        projectId: created.id,
        storedTemplate: encodeStoredAdTemplate(template),
        keyframes: plan.keyframes,
        voiceoverPending,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("从 Look 创建项目失败:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : errText(req, "从 Look 创建项目失败", "Failed to create project from Looks"),
      },
      { status: 500 }
    );
  }
}
