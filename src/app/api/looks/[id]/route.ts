import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { storedPathToUrl, toLookDto } from "@/lib/garments";
import { getPosePreset } from "@/lib/pose-presets";
import { loadOrderedGarments, parseLlmConfig, scoreExistingLook } from "@/lib/tryon/run-look";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

/** PATCH /api/looks/[id] { action: "accept" | "reject" | "rescore" } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const action = body.action;
    if (action !== "accept" && action !== "reject" && action !== "rescore") {
      return apiError(
        req,
        "未知操作，仅支持 accept、reject 或 rescore",
        "Unknown action; use accept, reject or rescore",
        400
      );
    }

    const db = getDb();
    const [row] = await db.select().from(looks).where(eq(looks.id, id)).limit(1);
    if (!row) return apiError(req, "Look 不存在", "Look not found", 404);

    const now = new Date();
    if (action === "rescore") {
      const llmConfig = parseLlmConfig(body.llmConfig);
      if (!llmConfig) {
        return apiError(
          req,
          "打分需要 llmConfig（baseUrl + model）",
          "Rescore requires llmConfig (baseUrl + model)",
          400
        );
      }
      const imageUrl = storedPathToUrl(row.imagePath);
      if (!imageUrl) {
        return apiError(req, "该 Look 还没有图片，无法打分", "Look has no image to score", 400);
      }
      const pose = getPosePreset(row.poseId);
      const locale = body.lang === "en" ? "en" : "zh";
      const loaded = await loadOrderedGarments(row.garmentSetId);
      const garmentUrls = (loaded?.garments ?? [])
        .map((g) => storedPathToUrl(g.frontPath))
        .filter((u): u is string => Boolean(u));
      const garmentNotes = (loaded?.garments ?? [])
        .map((g) => g.notes)
        .filter((n): n is string => Boolean(n))
        .join("; ");
      const snapshot = row.characterSnapshot;
      try {
        await scoreExistingLook({
          lookId: id,
          imageUrl,
          modelRefUrl: snapshot?.referenceImages?.[0],
          garmentUrls,
          poseDescription: pose?.prompt[locale] ?? row.poseId,
          garmentNotes,
          locale,
          config: llmConfig,
        });
      } catch (err) {
        console.error(`Look ${id} 重新打分失败:`, err);
        return apiError(req, "打分失败，请稍后重试", "Scoring failed, please retry", 502);
      }
      const [updated] = await db.select().from(looks).where(eq(looks.id, id)).limit(1);
      if (!updated) return apiError(req, "Look 不存在", "Look not found", 404);
      return NextResponse.json({ look: toLookDto(updated) });
    }

    if (action === "accept") {
      if (row.status !== "candidate" && row.status !== "rejected") {
        return apiError(req, "当前状态不可接受该 Look", "Look cannot be accepted from its current status", 409);
      }
      await db
        .update(looks)
        .set({ status: "candidate", updatedAt: now })
        .where(
          and(
            eq(looks.garmentSetId, row.garmentSetId),
            eq(looks.poseId, row.poseId),
            eq(looks.status, "accepted"),
            ne(looks.id, id)
          )
        );
      const [updated] = await db
        .update(looks)
        .set({ status: "accepted", updatedAt: now })
        .where(eq(looks.id, id))
        .returning();
      if (!updated) return apiError(req, "Look 不存在", "Look not found", 404);
      return NextResponse.json({ look: toLookDto(updated) });
    }

    if (row.status !== "candidate" && row.status !== "accepted") {
      return apiError(req, "当前状态不可拒绝该 Look", "Look cannot be rejected from its current status", 409);
    }
    const [updated] = await db
      .update(looks)
      .set({ status: "rejected", updatedAt: now })
      .where(eq(looks.id, id))
      .returning();
    if (!updated) return apiError(req, "Look 不存在", "Look not found", 404);
    return NextResponse.json({ look: toLookDto(updated) });
  } catch (error) {
    console.error("更新 Look 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "更新 Look 失败", "Failed to update look") },
      { status: 500 }
    );
  }
}
