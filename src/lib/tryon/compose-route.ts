/**
 * Compose try-on route — one multi-reference image-to-image call that dresses
 * the presenter in the whole garment set in a single generation.
 */
import { createProvider } from "@/lib/providers";
import type { ImageOptions } from "@/lib/providers";
import { buildLookPrompt, lookReferenceImages } from "./prompt";
import {
  MAX_GARMENTS_PER_LOOK,
  TryOnRouteError,
  type LookRequest,
  type LookResult,
  type TryOnRoute,
  type TryOnRouteContext,
} from "./types";

export const composeRoute: TryOnRoute = {
  id: "compose",
  displayName: { zh: "多图合成", en: "Multi-reference compose" },
  supports() {
    return true;
  },
  async generateLook(req: LookRequest, ctx: TryOnRouteContext): Promise<LookResult> {
    if (req.garments.length > MAX_GARMENTS_PER_LOOK) {
      throw new TryOnRouteError({
        route: "compose",
        poseId: req.pose.id,
        message: `单次 Look 最多 ${MAX_GARMENTS_PER_LOOK} 件服装`,
        retryable: false,
      });
    }

    const prompt = buildLookPrompt(req);
    const refs = lookReferenceImages(req);
    const provider = createProvider(ctx.providerConfig);

    let result;
    try {
      result = await provider.generateImage({
        ...((ctx.settings ?? {}) as Partial<ImageOptions>),
        modelId: ctx.modelId ?? "",
        mode: "image-to-image",
        prompt,
        referenceImageUrls: refs,
        referenceImageUrl: refs[0],
      });
    } catch (cause) {
      if (cause instanceof TryOnRouteError) throw cause;
      throw new TryOnRouteError({
        route: "compose",
        poseId: req.pose.id,
        message: cause instanceof Error ? cause.message : String(cause ?? "生图失败"),
        retryable: true,
        cause,
      });
    }

    const imageUrl = result.imageUrls?.[0];
    if (!imageUrl) {
      throw new TryOnRouteError({
        route: "compose",
        poseId: req.pose.id,
        message: "生图未返回图片",
        retryable: true,
      });
    }

    return {
      imageUrl,
      provider: ctx.providerConfig.name,
      model: ctx.modelId ?? result.modelId,
      prompt,
      taskId: result.taskId,
    };
  },
};
