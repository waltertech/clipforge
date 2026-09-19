import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garments, garmentSets } from "@/lib/db/schema";
import { getUploadsDir } from "@/lib/paths";
import { apiError, errText } from "@/lib/api-error";
import type { GarmentCategory } from "@/lib/pose-presets";
import type { GarmentView } from "@/lib/tryon/types";
import {
  clipText,
  isGarmentCategory,
  isGarmentView,
  MAX_GARMENT_NAME,
  MAX_GARMENT_NOTES,
  parseColorTags,
  toGarmentDto,
} from "@/lib/garments";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

async function unlinkStored(stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  const rel = stored.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\//, "").replace(/^\/api\/files\//, "");
  if (!rel || rel.includes("..")) return;
  await unlink(join(getUploadsDir(), rel)).catch(() => {});
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的服装 ID", "Invalid garment id", 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }

    const patch: {
      name?: string;
      category?: GarmentCategory;
      view?: GarmentView;
      notes?: string | null;
      colorTags?: string[];
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if ("name" in body) {
      const name = clipText(body.name, MAX_GARMENT_NAME);
      if (!name) return apiError(req, "服装名称不能为空", "Garment name cannot be empty", 400);
      patch.name = name;
    }
    if ("category" in body) {
      if (!isGarmentCategory(body.category)) {
        return apiError(req, "无效的服装类目", "Invalid garment category", 400);
      }
      patch.category = body.category;
    }
    if ("view" in body) {
      if (!isGarmentView(body.view)) {
        return apiError(req, "无效的拍摄视角，仅支持 flat 或 on-model", "Invalid view; use flat or on-model", 400);
      }
      patch.view = body.view;
    }
    if ("notes" in body) {
      if (body.notes == null) patch.notes = null;
      else if (typeof body.notes !== "string") {
        return apiError(req, "备注必须是字符串", "Notes must be a string", 400);
      } else {
        patch.notes = clipText(body.notes, MAX_GARMENT_NOTES) || null;
      }
    }
    if ("colorTags" in body) {
      patch.colorTags = parseColorTags(body.colorTags);
    }

    const db = getDb();
    const [row] = await db.update(garments).set(patch).where(eq(garments.id, id)).returning();
    if (!row) return apiError(req, "服装不存在", "Garment not found", 404);
    return NextResponse.json({ garment: toGarmentDto(row) });
  } catch (error) {
    console.error("更新服装失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "更新服装失败", "Failed to update garment") },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的服装 ID", "Invalid garment id", 400);
    }

    const db = getDb();
    const [existing] = await db.select().from(garments).where(eq(garments.id, id)).limit(1);
    if (!existing) return apiError(req, "服装不存在", "Garment not found", 404);

    const sets = await db.select({ garmentIds: garmentSets.garmentIds }).from(garmentSets);
    const used = sets.some((s) => (s.garmentIds ?? []).includes(id));
    if (used) {
      return apiError(
        req,
        "该服装已被搭配使用，请先从搭配中移除",
        "Garment is used by a garment set; remove it from the set first",
        409
      );
    }

    await db.delete(garments).where(eq(garments.id, id));
    await unlinkStored(existing.frontPath);
    await unlinkStored(existing.backPath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("删除服装失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "删除服装失败", "Failed to delete garment") },
      { status: 500 }
    );
  }
}
