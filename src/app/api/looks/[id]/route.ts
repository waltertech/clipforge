import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { toLookDto } from "@/lib/garments";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

/** PATCH /api/looks/[id] { action: "accept" | "reject" } */
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
    if (action !== "accept" && action !== "reject") {
      return apiError(req, "未知操作，仅支持 accept 或 reject", "Unknown action; use accept or reject", 400);
    }

    const db = getDb();
    const [row] = await db.select().from(looks).where(eq(looks.id, id)).limit(1);
    if (!row) return apiError(req, "Look 不存在", "Look not found", 404);

    const now = new Date();
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
