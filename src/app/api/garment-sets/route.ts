import { NextRequest, NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garments, garmentSets } from "@/lib/db/schema";
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

function parseGarmentIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > MAX_GARMENTS_PER_LOOK) return null;
  if (!raw.every((id) => typeof id === "string" && id.trim().length > 0)) return null;
  return raw.map((id) => (id as string).trim());
}

async function resolveSetGarments(
  ids: string[]
): Promise<{ dtos: GarmentDto[]; missing: boolean }> {
  if (ids.length === 0) return { dtos: [], missing: false };
  const db = getDb();
  const rows = await db.select().from(garments).where(inArray(garments.id, ids));
  const ordered = pickByIds(ids, rows);
  return { dtos: ordered.map(toGarmentDto), missing: ordered.length !== ids.length };
}

/** GET /api/garment-sets — newest first, garments resolved in garmentIds order */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const rows = await db.select().from(garmentSets).orderBy(desc(garmentSets.createdAt));
    const allIds = Array.from(new Set(rows.flatMap((r) => r.garmentIds ?? [])));
    const garmentRows = allIds.length
      ? await db.select().from(garments).where(inArray(garments.id, allIds))
      : [];
    const dtoById = new Map(garmentRows.map((g) => [g.id, toGarmentDto(g)]));
    const sets = rows.map((row) => {
      const ids = row.garmentIds ?? [];
      const resolved = ids.map((id) => dtoById.get(id)).filter((g): g is GarmentDto => !!g);
      return toGarmentSetDto(row, resolved);
    });
    return NextResponse.json({ sets });
  } catch (error) {
    console.error("获取服装搭配失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取服装搭配失败", "Failed to list garment sets") },
      { status: 500 }
    );
  }
}

/** POST /api/garment-sets JSON { name, garmentIds, characterId? } */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }

    const name = clipText(body.name, MAX_GARMENT_SET_NAME);
    if (!name) return apiError(req, "缺少搭配名称", "Missing garment set name", 400);

    const garmentIds = parseGarmentIds(body.garmentIds);
    if (!garmentIds) {
      return apiError(
        req,
        `服装列表须为 1–${MAX_GARMENTS_PER_LOOK} 个已有服装 ID`,
        `garmentIds must be 1–${MAX_GARMENTS_PER_LOOK} existing garment ids`,
        400
      );
    }

    const { dtos, missing } = await resolveSetGarments(garmentIds);
    if (missing) {
      return apiError(req, "部分服装不存在", "One or more garments do not exist", 400);
    }

    const characterId =
      body.characterId == null || body.characterId === ""
        ? null
        : typeof body.characterId === "string"
          ? body.characterId
          : null;
    if (body.characterId != null && body.characterId !== "" && typeof body.characterId !== "string") {
      return apiError(req, "characterId 必须是字符串或 null", "characterId must be a string or null", 400);
    }

    const db = getDb();
    const [row] = await db
      .insert(garmentSets)
      .values({ name, garmentIds, characterId })
      .returning();

    return NextResponse.json({ set: toGarmentSetDto(row, dtos) }, { status: 201 });
  } catch (error) {
    console.error("创建服装搭配失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "创建服装搭配失败", "Failed to create garment set") },
      { status: 500 }
    );
  }
}
