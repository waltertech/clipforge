import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { garments } from "@/lib/db/schema";
import { getDataDir } from "@/lib/paths";
import { apiError, errText } from "@/lib/api-error";
import {
  clipText,
  isGarmentCategory,
  isGarmentView,
  MAX_GARMENT_NAME,
  MAX_GARMENT_NOTES,
  parseColorTags,
  toGarmentDto,
} from "@/lib/garments";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function asFile(value: FormDataEntryValue | null): File | null {
  if (value && typeof value === "object" && "arrayBuffer" in value && "size" in value) {
    return value as File;
  }
  return null;
}

function extOf(file: File): string | null {
  const rawName = file.name.replace(/[/\\]/g, "");
  const fromName = rawName.includes(".") ? rawName.split(".").pop()?.toLowerCase() : "";
  if (fromName && ALLOWED_EXTENSIONS.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return fromName || null;
}

async function saveGarmentImage(file: File, destAbs: string): Promise<void> {
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(destAbs, buf);
}

function matchesQuery(
  row: { name: string; notes: string | null; colorTags: string[] | null },
  q: string
): boolean {
  const n = q.toLowerCase();
  if (row.name.toLowerCase().includes(n)) return true;
  if ((row.notes ?? "").toLowerCase().includes(n)) return true;
  return (row.colorTags ?? []).some((t) => t.toLowerCase().includes(n));
}

/** GET /api/garments?category=&q= — newest first */
export async function GET(req: NextRequest) {
  try {
    const categoryRaw = req.nextUrl.searchParams.get("category");
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (categoryRaw && !isGarmentCategory(categoryRaw)) {
      return apiError(req, "无效的服装类目", "Invalid garment category", 400);
    }
    const category = isGarmentCategory(categoryRaw) ? categoryRaw : undefined;

    const db = getDb();
    const rows = category
      ? await db.select().from(garments).where(eq(garments.category, category)).orderBy(desc(garments.createdAt))
      : await db.select().from(garments).orderBy(desc(garments.createdAt));

    const filtered = q ? rows.filter((row) => matchesQuery(row, q)) : rows;
    return NextResponse.json({ garments: filtered.map(toGarmentDto) });
  } catch (error) {
    console.error("获取服装列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取服装列表失败", "Failed to list garments") },
      { status: 500 }
    );
  }
}

/** POST /api/garments multipart — create one garment with front (required) / back (optional) images */
export async function POST(req: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return apiError(req, "无效的表单数据，请检查上传的文件", "Invalid form data, please check the uploaded files");
    }

    const name = clipText(formData.get("name"), MAX_GARMENT_NAME);
    if (!name) {
      return apiError(req, "缺少服装名称", "Missing garment name", 400);
    }

    const categoryRaw = typeof formData.get("category") === "string" ? (formData.get("category") as string) : "";
    if (!isGarmentCategory(categoryRaw)) {
      return apiError(req, "缺少或无效的服装类目", "Missing or invalid garment category", 400);
    }

    const viewRaw = formData.get("view");
    const view = viewRaw == null || viewRaw === "" ? "flat" : viewRaw;
    if (!isGarmentView(view)) {
      return apiError(req, "无效的拍摄视角，仅支持 flat 或 on-model", "Invalid view; use flat or on-model", 400);
    }

    const notesRaw = formData.get("notes");
    const notes =
      notesRaw == null || notesRaw === ""
        ? null
        : clipText(typeof notesRaw === "string" ? notesRaw : "", MAX_GARMENT_NOTES) || null;

    const colorTags = parseColorTags(formData.get("colorTags"));

    const front = asFile(formData.get("front"));
    if (!front) {
      return apiError(req, "请上传服装正面图", "Please upload a front image", 400);
    }
    const back = asFile(formData.get("back"));

    for (const file of [front, back]) {
      if (!file) continue;
      if (file.size > MAX_FILE_SIZE) {
        return apiError(req, `文件 ${file.name} 超过 20MB 大小限制`, `File ${file.name} exceeds the 20MB size limit`, 413);
      }
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return apiError(
          req,
          `文件 ${file.name} 类型不支持，仅允许 JPEG / PNG / WebP`,
          `File ${file.name} type is not supported; only JPEG / PNG / WebP are allowed`,
          415
        );
      }
      const rawName = file.name.replace(/[/\\]/g, "");
      if (rawName.includes(".")) {
        const namedExt = rawName.split(".").pop()?.toLowerCase() || "";
        if (!ALLOWED_EXTENSIONS.has(namedExt)) {
          return apiError(req, `文件 ${file.name} 扩展名不支持`, `File ${file.name} extension is not supported`, 415);
        }
      }
      if (!extOf(file)) {
        return apiError(req, `文件 ${file.name} 扩展名不支持`, `File ${file.name} extension is not supported`, 415);
      }
    }

    const id = crypto.randomUUID();
    const frontExt = extOf(front) ?? "png";
    const frontName = `${id}-front.${frontExt}`;
    const dir = join(getDataDir(), "uploads", "garments");
    await mkdir(dir, { recursive: true });
    await saveGarmentImage(front, join(dir, frontName));

    let backPath: string | null = null;
    if (back) {
      const backExt = extOf(back) ?? "png";
      const backName = `${id}-back.${backExt}`;
      await saveGarmentImage(back, join(dir, backName));
      backPath = `garments/${backName}`;
    }

    const db = getDb();
    const [row] = await db
      .insert(garments)
      .values({
        id,
        name,
        category: categoryRaw,
        view,
        frontPath: `garments/${frontName}`,
        backPath,
        colorTags,
        notes,
      })
      .returning();

    return NextResponse.json({ garment: toGarmentDto(row) }, { status: 201 });
  } catch (error) {
    console.error("创建服装失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "创建服装失败", "Failed to create garment") },
      { status: 500 }
    );
  }
}
