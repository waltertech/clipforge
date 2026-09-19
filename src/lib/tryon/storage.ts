/**
 * Look / garment image persistence — data URIs and remote URLs land under
 * `getDataDir()/uploads/...` and are served back as `/api/files/...`.
 *
 * The decode rules match `/api/characters/sheet` so provider outputs (data: or
 * https) behave the same across features.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(seg: string): void {
  if (!seg || !SAFE_SEGMENT.test(seg)) {
    throw new Error(`非法路径片段: ${seg}`);
  }
}

/** mkdir `getDataDir()/uploads/<segments...>` and return the absolute directory. */
export async function uploadsSubdir(...segments: string[]): Promise<string> {
  for (const seg of segments) assertSafeSegment(seg);
  const dir = join(getDataDir(), "uploads", ...segments);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function garmentFileUrl(fileName: string): string {
  return `/api/files/garments/${fileName}`;
}

export function lookFileUrl(setId: string, fileName: string): string {
  return `/api/files/looks/${setId}/${fileName}`;
}

function extFromMeta(meta: string): string {
  const m = meta.toLowerCase();
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "png";
}

/**
 * Download or decode `sourceUrl` into `dir/${baseName}.${ext}`.
 * `dir` is an absolute directory (typically from `uploadsSubdir`).
 */
export async function persistImageSource(
  sourceUrl: string,
  dir: string,
  baseName: string
): Promise<{ filePath: string; fileName: string; ext: string }> {
  if (!baseName || /[\\/]/.test(baseName)) {
    throw new Error("非法文件名");
  }
  await mkdir(dir, { recursive: true });

  let buf: Buffer;
  let ext = "png";
  if (sourceUrl.startsWith("data:")) {
    const comma = sourceUrl.indexOf(",");
    if (comma === -1) throw new Error("无法解析 data URI 图片");
    buf = Buffer.from(sourceUrl.slice(comma + 1), "base64");
    ext = extFromMeta(sourceUrl.slice(5, comma));
  } else if (/^https?:\/\//.test(sourceUrl)) {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) throw new Error(`下载图片失败: ${resp.status}`);
    buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get("content-type") || "";
    ext = extFromMeta(ct);
  } else {
    throw new Error("不支持的图片来源");
  }

  const fileName = `${baseName}.${ext}`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, buf);
  return { filePath, fileName, ext };
}
