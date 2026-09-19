import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { parseScdet, mergeToMax, dropTiny, detectScenes } from "@/lib/reference/scenes";

const execFileAsync = promisify(execFile);

const SAMPLE_STDERR = `
[Parsed_scdet_0 @ 0x7f8a9c0] lavfi.scd.score: 14.250
[Parsed_scdet_0 @ 0x7f8a9c0] lavfi.scd.time: 2.500
[Parsed_scdet_0 @ 0x7f8a9c0] lavfi.scd.score: 21.000
[Parsed_scdet_0 @ 0x7f8a9c0] lavfi.scd.time: 5.000
[Parsed_scdet_0 @ 0x7f8a9c0] lavfi.scd.score: 18.750
[Parsed_scdet_0 @ 0x7f8a9c0] lavfi.scd.time: 8.250
`;

describe("parseScdet", () => {
  it("parses lavfi.scd.time cut points into contiguous ranges", () => {
    const ranges = parseScdet(SAMPLE_STDERR, 10);
    expect(ranges).toEqual([
      { start: 0, end: 2.5 },
      { start: 2.5, end: 5 },
      { start: 5, end: 8.25 },
      { start: 8.25, end: 10 },
    ]);
  });

  it("no cut points → a single range covering the whole duration", () => {
    expect(parseScdet("frame=  10 fps=0.0", 12.5)).toEqual([{ start: 0, end: 12.5 }]);
    expect(parseScdet("", 4)).toEqual([{ start: 0, end: 4 }]);
  });
});

describe("mergeToMax", () => {
  it("12 → 9 preserves total duration and adjacency", () => {
    const ranges = Array.from({ length: 12 }, (_, i) => ({ start: i, end: i + 1 }));
    const merged = mergeToMax(ranges, 9);
    expect(merged).toHaveLength(9);
    expect(merged[0].start).toBe(0);
    expect(merged[merged.length - 1].end).toBe(12);
    const total = merged.reduce((a, r) => a + (r.end - r.start), 0);
    expect(total).toBe(12);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start).toBe(merged[i - 1].end);
    }
  });
});

describe("dropTiny", () => {
  it("merges a sub-0.8s range into its neighbour", () => {
    const out = dropTiny([
      { start: 0, end: 2 },
      { start: 2, end: 2.3 },
      { start: 2.3, end: 5 },
    ]);
    expect(out).toEqual([
      { start: 0, end: 2.3 },
      { start: 2.3, end: 5 },
    ]);
  });

  it("merges a leading tiny range into the next", () => {
    expect(dropTiny([{ start: 0, end: 0.4 }, { start: 0.4, end: 3 }])).toEqual([{ start: 0, end: 3 }]);
  });
});

async function scdetAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(ffmpegBin(), ["-hide_banner", "-filters"], { timeout: 15_000 });
    return /\bscdet\b/.test(stdout);
  } catch {
    return false;
  }
}

describe("detectScenes integration", () => {
  let hasScdet = false;
  beforeAll(async () => {
    hasScdet = await scdetAvailable();
  });

  it("two colour segments via lavfi → 2 ranges (skipped if scdet missing)", async (ctx) => {
    if (!hasScdet) ctx.skip();
    const dir = await mkdtemp(join(tmpdir(), "cf-scdet-"));
    const video = join(dir, "two-colour.mp4");
    try {
      await execFileAsync(
        ffmpegBin(),
        [
          "-nostdin",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=320x240:d=2:r=25",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=320x240:d=2:r=25",
          "-filter_complex",
          "[0:v][1:v]concat=n=2:v=1:a=0",
          "-pix_fmt",
          "yuv420p",
          video,
        ],
        { timeout: 60_000 },
      );
      const { ranges, fallback } = await detectScenes(video, 4);
      expect(fallback).toBe(false);
      expect(ranges.length).toBe(2);
      expect(ranges[0].start).toBeCloseTo(0, 1);
      expect(ranges[ranges.length - 1].end).toBeCloseTo(4, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
