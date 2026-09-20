import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPosePreset } from "@/lib/pose-presets";
import type { LookRequest } from "@/lib/tryon/types";
import { TryOnRouteError } from "@/lib/tryon/types";

const { generateImage, createProvider } = vi.hoisted(() => {
  const generateImage = vi.fn();
  const createProvider = vi.fn(() => ({ generateImage }));
  return { generateImage, createProvider };
});

vi.mock("@/lib/providers", () => ({
  createProvider,
}));

import { composeRoute } from "@/lib/tryon/compose-route";

const pose = getPosePreset("three_quarter")!;

function req(overrides: Partial<LookRequest> = {}): LookRequest {
  return {
    modelRefs: ["m1", "m2"],
    modelAppearance: "32 岁居家女性",
    garments: [
      { url: "f1", category: "tops", view: "flat", backUrl: "b1", notes: "米白针织" },
      { url: "f2", category: "bottoms", view: "on-model" },
    ],
    pose,
    aspect: "3:4",
    lock: { face: true, garmentPattern: true },
    lang: "zh",
    ...overrides,
  };
}

const ctx = {
  providerConfig: { name: "fal-ai", apiKey: "k", baseUrl: "" },
  modelId: "flux-edit",
  settings: {},
};

describe("compose 试衣路线", () => {
  beforeEach(() => {
    generateImage.mockReset();
    createProvider.mockClear();
    generateImage.mockResolvedValue({
      taskId: "task-1",
      imageUrls: ["https://cdn.example/look.png"],
      modelId: "flux-edit",
    });
  });

  it("supports 对任意类目返回 true", () => {
    expect(composeRoute.supports([])).toBe(true);
    expect(composeRoute.supports(["shoes", "accessory"])).toBe(true);
    expect(composeRoute.id).toBe("compose");
  });

  it("generateImage 使用 image-to-image，参考图顺序为模特 → 服装正面 → 背面，prompt 含姿态", async () => {
    const look = req();
    const result = await composeRoute.generateLook(look, ctx);

    expect(createProvider).toHaveBeenCalledWith(ctx.providerConfig);
    expect(generateImage).toHaveBeenCalledTimes(1);
    const arg = generateImage.mock.calls[0][0] as {
      mode: string;
      prompt: string;
      referenceImageUrls: string[];
      referenceImageUrl: string;
      modelId: string;
    };
    expect(arg.mode).toBe("image-to-image");
    expect(arg.modelId).toBe("flux-edit");
    expect(arg.referenceImageUrls).toEqual(["m1", "m2", "f1", "f2", "b1"]);
    expect(arg.referenceImageUrl).toBe("m1");
    expect(arg.prompt).toContain(pose.prompt.zh);
    expect(result.imageUrl).toBe("https://cdn.example/look.png");
    expect(result.provider).toBe("fal-ai");
    expect(result.model).toBe("flux-edit");
    expect(result.taskId).toBe("task-1");
    expect(result.prompt).toBe(arg.prompt);
  });

  it("provider 抛错时抛出带 route/poseId 的可重试 TryOnRouteError", async () => {
    generateImage.mockRejectedValue(new Error("upstream 500"));
    try {
      await composeRoute.generateLook(req(), ctx);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TryOnRouteError);
      const e = err as TryOnRouteError;
      expect(e.route).toBe("compose");
      expect(e.poseId).toBe(pose.id);
      expect(e.retryable).toBe(true);
      expect(e.message).toContain("upstream 500");
    }
  });

  it("未返回图片时抛出带 route/poseId 的可重试 TryOnRouteError", async () => {
    generateImage.mockResolvedValue({ taskId: "t", imageUrls: [], modelId: "flux-edit" });
    await expect(composeRoute.generateLook(req(), ctx)).rejects.toMatchObject({
      name: "TryOnRouteError",
      route: "compose",
      poseId: pose.id,
      retryable: true,
    });
  });

  it("超过 5 件服装以不可重试错误拒绝，且不调用 provider", async () => {
    const garments = Array.from({ length: 6 }, (_, i) => ({
      url: `g${i}`,
      category: "tops" as const,
      view: "flat" as const,
    }));
    try {
      await composeRoute.generateLook(req({ garments }), ctx);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TryOnRouteError);
      const e = err as TryOnRouteError;
      expect(e.retryable).toBe(false);
      expect(e.route).toBe("compose");
      expect(e.poseId).toBe(pose.id);
    }
    expect(generateImage).not.toHaveBeenCalled();
  });
});
