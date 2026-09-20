/**
 * Per-shot first / middle / last frame grab for the reference reader.
 * Output: 512px-wide JPEGs named `<shotIndex>-<0|1|2>.jpg` in outDir.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, stat } from "fs/promises";
import { join } from "path";
import { ffmpegBin } from "@/lib/ffmpeg-path";

const execFileAsync = promisify(execFile);

export interface ShotSpan {
  start: number;
  end: number;
}

export function shotFrameTimes(shot: ShotSpan): [number, number, number] {
  const start = Number.isFinite(shot.start) ? Math.max(0, shot.start) : 0;
  const end = Number.isFinite(shot.end) ? Math.max(start, shot.end) : start;
  const first = start;
  const mid = start + (end - start) / 2;
  const last = end > start ? Math.max(start, end - 0.04) : start;
  return [first, mid, last];
}

async function grabFrame(filePath: string, time: number, outPath: string): Promise<boolean> {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  try {
    await execFileAsync(
      ffmpegBin(),
      [
        "-nostdin",
        "-y",
        "-ss",
        t.toFixed(3),
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=512:-2",
        "-q:v",
        "3",
        outPath,
      ],
      { timeout: 60_000 },
    );
    const st = await stat(outPath);
    return st.size > 0;
  } catch {
    return false;
  }
}

/** Extract 3 frames per shot; returns relative file names aligned with `shots` (missing grabs omitted). */
export async function extractShotFrames(
  filePath: string,
  shots: ShotSpan[],
  outDir: string,
): Promise<string[][]> {
  await mkdir(outDir, { recursive: true });
  const perShot: string[][] = [];
  for (let i = 0; i < shots.length; i++) {
    const times = shotFrameTimes(shots[i]);
    const names: string[] = [];
    for (let n = 0; n < times.length; n++) {
      const fileName = `${i}-${n}.jpg`;
      const ok = await grabFrame(filePath, times[n], join(outDir, fileName));
      if (ok) names.push(fileName);
    }
    perShot.push(names);
  }
  return perShot;
}
