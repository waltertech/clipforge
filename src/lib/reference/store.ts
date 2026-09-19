/**
 * Filesystem job store for reference-video derivation.
 * Layout: uploads/reference/<id>/job.json, source.<ext>, frames/<shot>-<n>.jpg
 * No DB / schema change — jobs are not recipes until the user saves via /api/ad-template/mine.
 */
import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import type { ReferenceJob } from "@/lib/reference/types";

export const REFERENCE_ID_RE = /^[a-f0-9-]{36}$/;

export function isReferenceId(id: unknown): id is string {
  return typeof id === "string" && REFERENCE_ID_RE.test(id);
}

export function jobDir(id: string): string {
  if (!isReferenceId(id)) throw new Error("invalid reference id");
  return join(getDataDir(), "uploads", "reference", id);
}

export function jobJsonPath(id: string): string {
  return join(jobDir(id), "job.json");
}

export function framesDir(id: string): string {
  return join(jobDir(id), "frames");
}

export function publicFrameUrl(id: string, fileName: string): string {
  return `/api/files/reference/${id}/frames/${encodeURIComponent(fileName)}`;
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, filePath);
}

export async function createJob(init: { source: ReferenceJob["source"]; id?: string }): Promise<ReferenceJob> {
  const id = init.id ?? crypto.randomUUID();
  if (!isReferenceId(id)) throw new Error("invalid reference id");
  const now = new Date().toISOString();
  const job: ReferenceJob = {
    id,
    stage: "queued",
    createdAt: now,
    updatedAt: now,
    source: init.source,
  };
  await mkdir(framesDir(id), { recursive: true });
  await atomicWrite(jobJsonPath(id), JSON.stringify(job));
  return job;
}

export async function readJob(id: string): Promise<ReferenceJob | null> {
  if (!isReferenceId(id)) return null;
  try {
    const raw = await readFile(jobJsonPath(id), "utf8");
    const parsed = JSON.parse(raw) as ReferenceJob;
    if (!parsed || parsed.id !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function updateJob(id: string, patch: Partial<Omit<ReferenceJob, "id">>): Promise<ReferenceJob> {
  const current = await readJob(id);
  if (!current) throw new Error("unknown reference job");
  const next: ReferenceJob = {
    ...current,
    ...patch,
    id: current.id,
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(jobJsonPath(id), JSON.stringify(next));
  return next;
}

export async function listFrames(id: string): Promise<string[]> {
  if (!isReferenceId(id)) return [];
  try {
    const names = await readdir(framesDir(id));
    return names.filter((n) => /\.(jpe?g)$/i.test(n) && !n.startsWith(".")).sort();
  } catch {
    return [];
  }
}

export async function sourceFilePath(id: string): Promise<string | null> {
  if (!isReferenceId(id)) return null;
  try {
    const names = await readdir(jobDir(id));
    const src = names.find((n) => n.startsWith("source.") && !n.endsWith(".tmp"));
    return src ? join(jobDir(id), src) : null;
  } catch {
    return null;
  }
}

export async function writeSourceFile(id: string, buf: Buffer, ext: string): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  const filePath = join(jobDir(id), `source.${safeExt}`);
  await mkdir(jobDir(id), { recursive: true });
  await writeFile(filePath, buf);
  return filePath;
}

/** Rewrite on-disk relative frame names to the public /api/files URL the editor loads. */
export function publicizeJob(job: ReferenceJob): ReferenceJob {
  const shots = job.shots?.map((s) => ({
    ...s,
    frames: (s.frames ?? []).map((f) =>
      f.startsWith("/api/files/") ? f : publicFrameUrl(job.id, f.split(/[\\/]/).pop() || f),
    ),
  }));
  return shots ? { ...job, shots } : job;
}
