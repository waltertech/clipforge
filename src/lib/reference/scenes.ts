/**
 * Scene cut detection for reference videos.
 * ffmpeg `scdet` dumps `lavfi.scd.time` / `lavfi.scd.score` on stderr; we turn those
 * timestamps into contiguous [start, end) ranges, drop sub-0.8s slivers, and merge
 * down to FASHION_MAX_SHOTS (9) by collapsing the shortest adjacent pairs.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { FASHION_MAX_SHOTS } from "@/lib/ad-templates";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import type { SceneRange } from "@/lib/reference/types";

const execFileAsync = promisify(execFile);

export function parseScdet(stderr: string, duration: number): SceneRange[] {
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const times: number[] = [];
  const timeRe = /lavfi\.scd\.time\s*[=:]\s*([0-9.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = timeRe.exec(stderr))) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0.05 && t < dur - 0.05) times.push(t);
  }
  const cuts = [...new Set(times.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
  if (cuts.length === 0) return [{ start: 0, end: dur }];
  const ranges: SceneRange[] = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev) ranges.push({ start: prev, end: c });
    prev = c;
  }
  if (prev < dur) ranges.push({ start: prev, end: dur });
  return ranges.length > 0 ? ranges : [{ start: 0, end: dur }];
}

/** Merge sub-minSec ranges into a neighbour (previous, or next if first). */
export function dropTiny(ranges: SceneRange[], minSec = 0.8): SceneRange[] {
  if (ranges.length <= 1) return ranges.map((r) => ({ ...r }));
  const out = ranges.map((r) => ({ ...r }));
  let i = 0;
  while (i < out.length) {
    if (out.length === 1) break;
    const d = out[i].end - out[i].start;
    if (d >= minSec) {
      i += 1;
      continue;
    }
    if (i === 0) {
      out[1] = { start: out[0].start, end: out[1].end };
      out.splice(0, 1);
      i = 0;
    } else {
      out[i - 1] = { start: out[i - 1].start, end: out[i].end };
      out.splice(i, 1);
      i -= 1;
    }
  }
  return out;
}

/** Collapse shortest adjacent pairs until length ≤ max, preserving total span. */
export function mergeToMax(ranges: SceneRange[], max = FASHION_MAX_SHOTS): SceneRange[] {
  const out = ranges.map((r) => ({ ...r }));
  while (out.length > max && out.length > 1) {
    let best = 0;
    let bestDur = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      const merged = out[i + 1].end - out[i].start;
      if (merged < bestDur) {
        bestDur = merged;
        best = i;
      }
    }
    out[best] = { start: out[best].start, end: out[best + 1].end };
    out.splice(best + 1, 1);
  }
  return out;
}

function evenSplit(duration: number, n: number): SceneRange[] {
  const count = Math.max(1, n);
  const dur = Math.max(0, duration);
  const slice = dur / count;
  return Array.from({ length: count }, (_, i) => ({
    start: i * slice,
    end: i === count - 1 ? dur : (i + 1) * slice,
  }));
}

/**
 * Run ffmpeg scdet. Non-zero exit (missing filter, decode error) falls back to an
 * even split of min(4, …) ranges so the rest of the pipeline still has shot bounds.
 */
export async function detectScenes(
  filePath: string,
  duration: number,
): Promise<{ ranges: SceneRange[]; fallback: boolean }> {
  try {
    const { stderr } = await execFileAsync(
      ffmpegBin(),
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "info",
        "-i",
        filePath,
        "-an",
        "-vf",
        "scdet=threshold=10",
        "-f",
        "null",
        "-",
      ],
      { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
    );
    const parsed = parseScdet(stderr ?? "", duration);
    return { ranges: mergeToMax(dropTiny(parsed)), fallback: false };
  } catch {
    // Any non-zero exit (including "No such filter: 'scdet'") → even split.
    const n = Math.min(4, Math.max(1, Math.floor(duration) || 1));
    return { ranges: evenSplit(duration, n), fallback: true };
  }
}
