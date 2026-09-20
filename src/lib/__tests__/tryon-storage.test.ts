import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { garmentFileUrl, lookFileUrl, persistImageSource } from "@/lib/tryon/storage";

describe("tryon storage", () => {
  it("URL helpers 形状正确", () => {
    expect(garmentFileUrl("abc-front.png")).toBe("/api/files/garments/abc-front.png");
    expect(lookFileUrl("set1", "look1.png")).toBe("/api/files/looks/set1/look1.png");
  });

  it("persistImageSource 解码 data URI 并按 content-type 选扩展名", async () => {
    const dir = await mkdtemp(join(tmpdir(), "look-"));
    try {
      // 1x1 red PNG
      const png =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const saved = await persistImageSource(png, dir, "look-1");
      expect(saved.ext).toBe("png");
      expect(saved.fileName).toBe("look-1.png");
      const buf = await readFile(saved.filePath);
      expect(buf.length).toBeGreaterThan(10);

      const jpgMeta = await persistImageSource("data:image/jpeg;base64,aaaa", dir, "look-2");
      expect(jpgMeta.ext).toBe("jpg");
      expect(jpgMeta.fileName).toBe("look-2.jpg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
