import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garmentSets, looks } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { storedPathToUrl } from "@/lib/garments";

/**
 * GET /api/looks/export?garmentSetId=&status=accepted|all
 * JSON manifest of looks for a set. Zip packaging is not available (no zip dependency).
 */
export async function GET(req: NextRequest) {
  try {
    const garmentSetId = req.nextUrl.searchParams.get("garmentSetId")?.trim() ?? "";
    if (!garmentSetId) {
      return apiError(req, "缺少 garmentSetId", "Missing garmentSetId", 400);
    }

    const statusParam = req.nextUrl.searchParams.get("status")?.trim() || "accepted";
    if (statusParam !== "accepted" && statusParam !== "all") {
      return apiError(req, "status 仅支持 accepted 或 all", "status must be accepted or all", 400);
    }

    const db = getDb();
    const [set] = await db.select().from(garmentSets).where(eq(garmentSets.id, garmentSetId)).limit(1);
    if (!set) return apiError(req, "服装搭配不存在", "Garment set not found", 404);

    const rows = await db
      .select()
      .from(looks)
      .where(eq(looks.garmentSetId, garmentSetId))
      .orderBy(desc(looks.createdAt));

    const filtered = statusParam === "all" ? rows : rows.filter((row) => row.status === "accepted");

    return NextResponse.json({
      garmentSet: { id: set.id, name: set.name },
      looks: filtered.map((row) => ({
        id: row.id,
        poseId: row.poseId,
        status: row.status,
        imageUrl: storedPathToUrl(row.imagePath),
        absoluteFile: false as const,
      })),
    });
  } catch (error) {
    console.error("导出 Look 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "导出 Look 失败", "Failed to export looks") },
      { status: 500 }
    );
  }
}
