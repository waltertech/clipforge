import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garments, garmentSets } from "@/lib/db/schema";
import { getUploadsDir } from "@/lib/paths";
import { apiError, errText } from "@/lib/api-error";
import { MAX_GARMENTS_PER_LOOK } from "@/lib/tryon/types";
import {
  clipText,
  MAX_GARMENT_SET_NAME,
  pickByIds,
  toGarmentDto,
  toGarmentSetDto,
  type GarmentDto,
} from "@/lib/garments";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

function parseGarmentIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > MAX_GARMENTS_PER_LOOK) return null;
  if (!raw.every((id) => typeof id === "string" && id.trim().length > 0)) return null;
  return raw.map((id) => (id as string).trim());
}

async function garmentsForIds(ids: string[]): Promise<{ dtos: GarmentDto[]; missing: boolean }> {
  if (ids.length === 0) return { dtos: [], missing: false };
  const db = getDb();
  const rows = await db.select().from(garments).where(inArray(garments.id, ids));
  const ordered = pickByIds(ids, rows);
  return { dtos: ordered.map(toGarmentDto), missing: ordered.length !== ids.length };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的搭配 ID", "Invalid garment set id", 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }

    const db = getDb();
    const [existing] = await db.select().from(garmentSets).where(eq(garmentSets.id, id)).limit(1);
    if (!existing) return apiError(req, "搭配不存在", "Garment set not found", 404);

    const patch: {
      name?: string;
      garmentIds?: string[];
      characterId?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if ("name" in body) {
      const name = clipText(body.name, MAX_GARMENT_SET_NAME);
      if (!name) return apiError(req, "搭配名称不能为空", "Garment set name cannot be empty", 400);
      patch.name = name;
    }

    let garmentIds = existing.garmentIds ?? [];
    if ("garmentIds" in body) {
      const parsed = parseGarmentIds(body.garmentIds);
      if (!parsed) {
        return apiError(
          req,
          `服装列表须为 1–${MAX_GARMENTS_PER_LOOK} 个已有服装 ID`,
          `garmentIds must be 1–${MAX_GARMENTS_PER_LOOK} existing garment ids`,
          400
        );
      }
      const { missing } = await garmentsForIds(parsed);
      if (missing) return apiError(req, "部分服装不存在", "One or more garments do not exist", 400);
      patch.garmentIds = parsed;
      garmentIds = parsed;
    }

    if ("characterId" in body) {
      if (body.characterId == null || body.characterId === "") {
        patch.characterId = null;
      } else if (typeof body.characterId === "string") {
        patch.characterId = body.characterId;
      } else {
        return apiError(req, "characterId 必须是字符串或 null", "characterId must be a string or null", 400);
      }
    }

    const [row] = await db.update(garmentSets).set(patch).where(eq(garmentSets.id, id)).returning();
    if (!row) return apiError(req, "搭配不存在", "Garment set not found", 404);

    const { dtos } = await garmentsForIds(row.garmentIds ?? garmentIds);
    return NextResponse.json({ set: toGarmentSetDto(row, dtos) });
  } catch (error) {
    console.error("更新服装搭配失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "更新服装搭配失败", "Failed to update garment set") },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的搭配 ID", "Invalid garment set id", 400);
    }

    const db = getDb();
    const [existing] = await db.select().from(garmentSets).where(eq(garmentSets.id, id)).limit(1);
    if (!existing) return apiError(req, "搭配不存在", "Garment set not found", 404);

    await db.delete(garmentSets).where(eq(garmentSets.id, id));
    await rm(join(getUploadsDir(), "looks", id), { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("删除服装搭配失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "删除服装搭配失败", "Failed to delete garment set") },
      { status: 500 }
    );
  }
}
