import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { toLookDto } from "@/lib/garments";

/** GET /api/looks?garmentSetId= — required query; newest first */
export async function GET(req: NextRequest) {
  try {
    const garmentSetId = req.nextUrl.searchParams.get("garmentSetId")?.trim() ?? "";
    if (!garmentSetId) {
      return apiError(req, "缺少 garmentSetId", "Missing garmentSetId", 400);
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(looks)
      .where(eq(looks.garmentSetId, garmentSetId))
      .orderBy(desc(looks.createdAt));

    return NextResponse.json({ looks: rows.map(toLookDto) });
  } catch (error) {
    console.error("获取 Look 列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取 Look 列表失败", "Failed to list looks") },
      { status: 500 }
    );
  }
}
