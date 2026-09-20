/**
 * POST /api/reference/ingest — accept an upload or public URL, create a filesystem
 * job, return 202 { referenceId }, then run probe → scenes → asr → frames → read → derive.
 *
 * ASR: local-asr.ts is a browser Whisper worker (no server-side transcribe helper),
 * so the asr stage is recorded then skipped (transcript: null).
 */
import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import { apiError } from "@/lib/api-error";
import { friendlyError } from "@/lib/friendly-error";
import { probeMedia } from "@/lib/media-probe";
import { validateMediaFile } from "@/lib/media-validate";
import { assertPublicUrl, safeFetch } from "@/lib/ssrf-guard";
import type { LLMConfig } from "@/lib/script-engine/generator";
import { defaultFashionShotRoles } from "@/lib/ad-templates";
import { detectScenes } from "@/lib/reference/scenes";
import { extractShotFrames } from "@/lib/reference/frames";
import { readReference } from "@/lib/reference/reader";
import { deriveFashionTemplate } from "@/lib/reference/template-derive";
import {
  createJob,
  framesDir,
  jobDir,
  readJob,
  sourceFilePath,
  updateJob,
  writeSourceFile,
} from "@/lib/reference/store";
import type { ReferenceShotRead } from "@/lib/reference/types";
import type { Shot } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 90;
const VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-quicktime",
  "video/x-mp4",
]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);

function parseLlmConfig(raw: unknown): LLMConfig | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (typeof c.baseUrl !== "string" || !c.baseUrl.trim() || typeof c.model !== "string" || !c.model.trim()) {
    return null;
  }
  return {
    baseUrl: c.baseUrl.trim(),
    apiKey: typeof c.apiKey === "string" ? c.apiKey : "",
    model: c.model.trim(),
    ...(typeof c.visionModel === "string" && c.visionModel.trim() && { visionModel: c.visionModel.trim() }),
  };
}

function parseLocale(raw: unknown): "zh" | "en" {
  return raw === "en" || raw === "en-US" ? "en" : "zh";
}

function extOf(fileName: string, mime?: string | null): string | null {
  const fromName = fileName.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXT.has(fromName)) return fromName;
  const ct = (mime || "").split(";")[0].trim().toLowerCase();
  if (ct === "video/mp4" || ct === "video/x-mp4") return "mp4";
  if (ct === "video/webm") return "webm";
  if (ct === "video/quicktime" || ct === "video/x-quicktime") return "mov";
  return null;
}

function stubShots(ranges: Array<{ start: number; end: number }>): ReferenceShotRead[] {
  const roles = defaultFashionShotRoles(ranges.length);
  return ranges.map((r, i) => ({
    index: i,
    start: r.start,
    end: r.end,
    role: (roles[i] ?? "demo") as Shot["type"],
    framing: "other",
    poseText: "",
    poseConfidence: 0,
    cameraText: "",
    onScreenText: [],
    hasSpeech: false,
    onCamera: false,
    frames: [],
  }));
}

async function runPipeline(id: string, llmConfig: LLMConfig, locale: "zh" | "en"): Promise<void> {
  try {
    await updateJob(id, { stage: "probe" });
    const src = await sourceFilePath(id);
    if (!src) throw new Error(locale === "en" ? "Source video missing" : "对标视频文件不存在");
    const probe = await probeMedia(src);
    const job = await readJob(id);
    if (!job) throw new Error("unknown reference job");
    await updateJob(id, {
      source: {
        ...job.source,
        durationSec: probe.duration,
        width: probe.width,
        height: probe.height,
      },
    });

    await updateJob(id, { stage: "scenes" });
    const detected = await detectScenes(src, probe.duration);
    const needs: string[] = detected.fallback ? ["scene detection fallback: even split"] : [];
    let shots = stubShots(detected.ranges);
    await updateJob(id, { shots });

    // local-asr is a browser worker; there is no server-side transcribe() to reuse.
    await updateJob(id, { stage: "asr", transcript: null });

    await updateJob(id, { stage: "frames" });
    const frameNames = await extractShotFrames(src, shots, framesDir(id));
    shots = shots.map((s, i) => ({ ...s, frames: frameNames[i] ?? [] }));
    await updateJob(id, { shots });

    await updateJob(id, { stage: "read" });
    const read = await readReference({
      job: (await readJob(id))!,
      frames: frameNames,
      transcript: null,
      locale,
      config: llmConfig,
      framesDir: framesDir(id),
    });
    shots = shots.map((s, i) => {
      const partial = read.shots[i] ?? {};
      return {
        ...s,
        ...partial,
        index: i,
        start: s.start,
        end: s.end,
        frames: s.frames,
      };
    });
    if (read.lowConfidence) needs.push("reader low confidence");
    await updateJob(id, { shots });

    await updateJob(id, { stage: "derive" });
    const { draft, needsConfirmation } = deriveFashionTemplate(shots, {
      referenceId: id,
      durationSec: probe.duration,
      hasTranscript: false,
      locale,
    });
    await updateJob(id, {
      draft,
      needsConfirmation: [...needs, ...needsConfirmation],
      stage: "done",
    });
  } catch (err) {
    console.error("reference ingest pipeline failed:", err);
    try {
      await updateJob(id, { stage: "failed", error: friendlyError(err, locale) });
    } catch (updateErr) {
      console.error("reference job mark-failed also failed:", updateErr);
    }
  }
}

async function ingestBuffer(
  req: NextRequest,
  buf: Buffer,
  ext: string,
  fileName: string,
  kind: "upload" | "url",
  llmConfig: LLMConfig,
  locale: "zh" | "en",
): Promise<NextResponse> {
  if (buf.byteLength > MAX_BYTES) {
    return apiError(req, "视频不能超过 200MB", "Video must be 200MB or smaller", 413);
  }
  const job = await createJob({ source: { kind, fileName } });
  try {
    const srcPath = await writeSourceFile(job.id, buf, ext);
    const ok = await validateMediaFile(srcPath, "video");
    if (!ok) {
      await rm(jobDir(job.id), { recursive: true, force: true });
      return apiError(req, "无法读取视频，文件可能损坏或不是视频", "Could not read the video; the file may be damaged or is not a video", 400);
    }
    const probe = await probeMedia(srcPath);
    if (!(probe.duration > 0)) {
      await rm(jobDir(job.id), { recursive: true, force: true });
      return apiError(req, "无法读取视频时长", "Could not read video duration", 400);
    }
    if (probe.duration > MAX_SECONDS) {
      await rm(jobDir(job.id), { recursive: true, force: true });
      return apiError(req, "对标视频最长 90 秒", "Reference videos can be up to 90 seconds", 400);
    }
    await updateJob(job.id, {
      source: {
        kind,
        fileName,
        durationSec: probe.duration,
        width: probe.width,
        height: probe.height,
      },
    });
  } catch (err) {
    await rm(jobDir(job.id), { recursive: true, force: true }).catch(() => {});
    return apiError(
      req,
      `无法处理视频：${friendlyError(err, "zh")}`,
      `Could not process the video: ${friendlyError(err, "en")}`,
      400,
    );
  }
  void runPipeline(job.id, llmConfig, locale);
  return NextResponse.json({ referenceId: job.id, stage: "queued" }, { status: 202 });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON", 400);
    }
    const llmConfig = parseLlmConfig(body.llmConfig);
    if (!llmConfig) {
      return apiError(req, "请先在设置中配置 LLM 参数", "Please configure the LLM in settings first", 400);
    }
    const locale = parseLocale(body.locale);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return apiError(req, "请提供视频链接或上传文件", "Provide a video URL or upload a file", 400);
    try {
      await assertPublicUrl(url);
    } catch (err) {
      return apiError(
        req,
        `链接不可用：${err instanceof Error ? err.message : String(err)}`,
        `URL rejected: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }
    let res: Response;
    try {
      res = await safeFetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      return apiError(
        req,
        `下载失败：${friendlyError(err, "zh")}`,
        `Download failed: ${friendlyError(err, "en")}`,
        400,
      );
    }
    if (!res.ok) {
      return apiError(req, `下载失败：HTTP ${res.status}`, `Download failed: HTTP ${res.status}`, 400);
    }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) {
      return apiError(req, "视频不能超过 200MB", "Video must be 200MB or smaller", 413);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return apiError(req, "视频不能超过 200MB", "Video must be 200MB or smaller", 413);
    }
    const ct = res.headers.get("content-type");
    const ext = extOf(url, ct);
    if (!ext) {
      return apiError(req, "仅支持 MP4 / WebM / MOV", "Only MP4, WebM, and MOV are supported", 415);
    }
    return ingestBuffer(req, buf, ext, url.split("?")[0].split("/").pop() || `source.${ext}`, "url", llmConfig, locale);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(req, "无效的表单数据，请检查上传的文件", "Invalid form data, please check the uploaded files", 400);
  }
  const llmConfig = parseLlmConfig(form.get("llmConfig"));
  if (!llmConfig) {
    return apiError(req, "请先在设置中配置 LLM 参数", "Please configure the LLM in settings first", 400);
  }
  const locale = parseLocale(form.get("locale"));
  const file = form.get("video");
  if (!(file instanceof File)) {
    return apiError(req, "请上传对标视频", "Please upload a reference video", 400);
  }
  if (file.size > MAX_BYTES) {
    return apiError(req, "视频不能超过 200MB", "Video must be 200MB or smaller", 413);
  }
  const mimeOk = !file.type || VIDEO_MIME.has(file.type) || file.type === "application/octet-stream";
  const ext = extOf(file.name, file.type);
  if (!ext || !mimeOk) {
    return apiError(req, "仅支持 MP4 / WebM / MOV", "Only MP4, WebM, and MOV are supported", 415);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  return ingestBuffer(req, buf, ext, file.name.replace(/[/\\]/g, "") || `source.${ext}`, "upload", llmConfig, locale);
}
