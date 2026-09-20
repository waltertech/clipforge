import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { toLookDto } from "@/lib/garments";

/** GET /api/looks?garmentSetId=&status= — garmentSetId required; newest first. Optional status filters the list. */
export async function GET(req: NextRequest) {
  try {
    const garmentSetId = req.nextUrl.searchParams.get("garmentSetId")?.trim() ?? "";
    if (!garmentSetId) {
      return apiError(req, "缺少 garmentSetId", "Missing garmentSetId", 400);
    }

    const status = req.nextUrl.searchParams.get("status")?.trim() ?? "";

    const db = getDb();
    const rows = await db
      .select()
      .from(looks)
      .where(eq(looks.garmentSetId, garmentSetId))
      .orderBy(desc(looks.createdAt));

    const mapped = rows.map(toLookDto);
    const filtered = !status || status === "all" ? mapped : mapped.filter((row) => row.status === status);

    return NextResponse.json({ looks: filtered });
  } catch (error) {
    console.error("获取 Look 列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取 Look 列表失败", "Failed to list looks") },
      { status: 500 }
    );
  }
}
