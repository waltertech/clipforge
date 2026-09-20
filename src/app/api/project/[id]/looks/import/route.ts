import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, looks, projects } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { persistAssetSource } from "@/lib/asset-persistence";
import { storedPathToUrl } from "@/lib/garments";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

/**
 * POST /api/project/[id]/looks/import
 * body: { looks: Array<{ lookId: string; shotId: number }> }
 * Copies accepted Looks into the project as assets(type=look, selected=true).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project id", 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }

    if (!Array.isArray(body.looks) || body.looks.length < 1) {
      return apiError(req, "缺少 looks 列表", "Missing looks list", 400);
    }

    const items: Array<{ lookId: string; shotId: number }> = [];
    for (const raw of body.looks) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return apiError(req, "looks 项格式无效", "Invalid looks item", 400);
      }
      const o = raw as Record<string, unknown>;
      if (typeof o.lookId !== "string" || !SAFE_ID.test(o.lookId)) {
        return apiError(req, "缺少有效的 lookId", "Missing valid lookId", 400);
      }
      if (typeof o.shotId !== "number" || !Number.isInteger(o.shotId) || o.shotId < 0) {
        return apiError(req, "缺少有效的 shotId", "Missing valid shotId", 400);
      }
      items.push({ lookId: o.lookId, shotId: o.shotId });
    }

    const db = getDb();
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return apiError(req, "项目不存在", "Project not found", 404);

    const created: Array<typeof assets.$inferSelect> = [];
    for (const item of items) {
      const [look] = await db.select().from(looks).where(eq(looks.id, item.lookId)).limit(1);
      if (!look) return apiError(req, `Look 不存在：${item.lookId}`, `Look not found: ${item.lookId}`, 404);
      if (look.status !== "accepted") {
        return apiError(
          req,
          `只能导入已采用的 Look（${item.lookId} 当前为 ${look.status}）`,
          `Only accepted looks can be imported (${item.lookId} is ${look.status})`,
          400
        );
      }
      const imageUrl = storedPathToUrl(look.imagePath);
      if (!imageUrl) {
        return apiError(req, `Look ${item.lookId} 没有图片`, `Look ${item.lookId} has no image`, 400);
      }

      const filePath = await persistAssetSource(id, imageUrl, item.shotId, "look");
      const rows = db.transaction((tx) => {
        tx.update(assets)
          .set({ selected: false })
          .where(and(eq(assets.projectId, id), eq(assets.shotId, item.shotId)))
          .run();
        return tx
          .insert(assets)
          .values({
            projectId: id,
            shotId: item.shotId,
            type: "look",
            filePath,
            provider: look.provider,
            model: look.model,
            prompt: look.prompt,
            selected: true,
            status: "done",
          })
          .returning()
          .all();
      });
      if (rows[0]) created.push(rows[0]);
    }

    return NextResponse.json({ assets: created });
  } catch (error) {
    console.error("导入 Look 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "导入 Look 失败", "Failed to import looks") },
      { status: 500 }
    );
  }
}
