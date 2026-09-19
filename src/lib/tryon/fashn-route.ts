/**
 * FASHN virtual try-on route (id "vton").
 *
 * One garment per `/run` call. Multi-garment Looks are applied inner → outer,
 * feeding each completed output back as the next `model_image`.
 */
import type { GarmentCategory } from "@/lib/pose-presets";
import {
  TryOnRouteError,
  type LookRequest,
  type LookResult,
  type TryOnRoute,
  type TryOnRouteContext,
} from "./types";

export const FASHN_DEFAULT_BASE_URL = "https://api.fashn.ai/v1";
export const FASHN_MODEL = "tryon-v1.6";
export const FASHN_POLL_INTERVAL_MS = 2000;
export const FASHN_POLL_TIMEOUT_MS = 120_000;

const UNSUPPORTED: ReadonlySet<string> = new Set(["shoes", "accessory"]);

type FashnCategory = "tops" | "bottoms" | "one-pieces";
type FetchLike = typeof fetch;

let injectedFetch: FetchLike | null = null;

/** Tests replace `fetch` without touching the network. Pass `null` to restore. */
export function setFashnFetch(fn: FetchLike | null): void {
  injectedFetch = fn;
}

function getFetch(): FetchLike {
  return injectedFetch ?? globalThis.fetch;
}

export function mapFashnCategory(category: GarmentCategory | string): FashnCategory | null {
  if (category === "tops" || category === "outerwear") return "tops";
  if (category === "bottoms") return "bottoms";
  if (category === "one-pieces") return "one-pieces";
  return null;
}

export function unsupportedFashnCategories(categories: readonly GarmentCategory[] | readonly string[]): string[] {
  return [...new Set(categories.filter((c) => UNSUPPORTED.has(c)))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(raw: unknown): string {
  const s = typeof raw === "string" && raw.trim() ? raw.trim() : FASHN_DEFAULT_BASE_URL;
  return s.replace(/\/+$/, "");
}

function readFashnSettings(ctx: TryOnRouteContext): { apiKey: string; baseUrl: string } {
  const settings = ctx.settings ?? {};
  const fashn =
    settings.fashn && typeof settings.fashn === "object"
      ? (settings.fashn as { apiKey?: unknown; baseUrl?: unknown })
      : undefined;
  const apiKey = typeof fashn?.apiKey === "string" ? fashn.apiKey.trim() : "";
  return { apiKey, baseUrl: normalizeBaseUrl(fashn?.baseUrl) };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function throwHttp(status: number, poseId: string, detail?: string): never {
  if (status === 401 || status === 403) {
    throw new TryOnRouteError({
      route: "vton",
      poseId,
      message: "FASHN API Key 无效或未配置",
      retryable: false,
    });
  }
  if (status === 429 || status >= 500) {
    throw new TryOnRouteError({
      route: "vton",
      poseId,
      message: `FASHN 请求失败 (${status})`,
      retryable: true,
    });
  }
  throw new TryOnRouteError({
    route: "vton",
    poseId,
    message: detail?.trim() || `FASHN 请求失败 (${status})`,
    retryable: false,
  });
}

async function fashnRequest(
  url: string,
  init: RequestInit,
  poseId: string
): Promise<{ res: Response; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await getFetch()(url, init);
  } catch (cause) {
    throw new TryOnRouteError({
      route: "vton",
      poseId,
      message: cause instanceof Error ? cause.message : "FASHN 网络错误",
      retryable: true,
      cause,
    });
  }
  const body = await readJson(res);
  if (!res.ok) {
    const detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : undefined;
    throwHttp(res.status, poseId, detail);
  }
  return { res, body };
}

function firstOutputUrl(body: Record<string, unknown>): string | undefined {
  const output = body.output;
  if (typeof output === "string" && output) return output;
  if (Array.isArray(output) && typeof output[0] === "string" && output[0]) return output[0];
  return undefined;
}

async function runOneStep(input: {
  baseUrl: string;
  apiKey: string;
  poseId: string;
  modelImage: string;
  garmentImage: string;
  category: FashnCategory;
}): Promise<{ imageUrl: string; taskId: string }> {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  const { body: runBody } = await fashnRequest(
    `${input.baseUrl}/run`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model_name: FASHN_MODEL,
        inputs: {
          model_image: input.modelImage,
          garment_image: input.garmentImage,
          category: input.category,
        },
      }),
    },
    input.poseId
  );
  const taskId = typeof runBody.id === "string" && runBody.id ? runBody.id : String(runBody.id ?? "");
  if (!taskId || taskId === "undefined") {
    throw new TryOnRouteError({
      route: "vton",
      poseId: input.poseId,
      message: "FASHN 未返回任务 id",
      retryable: true,
    });
  }

  const deadline = Date.now() + FASHN_POLL_TIMEOUT_MS;
  while (true) {
    const { body } = await fashnRequest(
      `${input.baseUrl}/status/${encodeURIComponent(taskId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${input.apiKey}` } },
      input.poseId
    );
    const status = typeof body.status === "string" ? body.status.toLowerCase() : "";
    if (status === "completed") {
      const imageUrl = firstOutputUrl(body);
      if (!imageUrl) {
        throw new TryOnRouteError({
          route: "vton",
          poseId: input.poseId,
          message: "FASHN 未返回图片",
          retryable: true,
        });
      }
      return { imageUrl, taskId };
    }
    if (status === "failed") {
      const err = typeof body.error === "string" && body.error ? body.error : "FASHN 试衣失败";
      throw new TryOnRouteError({
        route: "vton",
        poseId: input.poseId,
        message: err,
        retryable: true,
      });
    }
    if (Date.now() >= deadline) {
      throw new TryOnRouteError({
        route: "vton",
        poseId: input.poseId,
        message: "FASHN 试衣超时",
        retryable: true,
      });
    }
    const remaining = deadline - Date.now();
    await sleep(Math.min(FASHN_POLL_INTERVAL_MS, Math.max(0, remaining)));
  }
}

export const fashnRoute: TryOnRoute = {
  id: "vton",
  displayName: { zh: "FASHN 试衣", en: "FASHN try-on" },
  supports(categories) {
    return categories.every((c) => mapFashnCategory(c) !== null);
  },
  async generateLook(req: LookRequest, ctx: TryOnRouteContext): Promise<LookResult> {
    const poseId = req.pose.id;
    const { apiKey, baseUrl } = readFashnSettings(ctx);
    if (!apiKey) {
      throw new TryOnRouteError({
        route: "vton",
        poseId,
        message: "FASHN API Key 无效或未配置",
        retryable: false,
      });
    }
    const modelImage0 = req.modelRefs[0];
    if (!modelImage0) {
      throw new TryOnRouteError({
        route: "vton",
        poseId,
        message: "FASHN 试衣需要模特参考图",
        retryable: false,
      });
    }
    if (req.garments.length < 1) {
      throw new TryOnRouteError({
        route: "vton",
        poseId,
        message: "FASHN 试衣需要至少一件服装",
        retryable: false,
      });
    }
    if (!fashnRoute.supports(req.garments.map((g) => g.category))) {
      const names = unsupportedFashnCategories(req.garments.map((g) => g.category)).join("、");
      throw new TryOnRouteError({
        route: "vton",
        poseId,
        message: `FASHN 不支持 ${names || "当前"} 类目`,
        retryable: false,
      });
    }

    let modelImage = modelImage0;
    let lastId = "";
    let lastUrl = "";
    for (const garment of req.garments) {
      const category = mapFashnCategory(garment.category);
      if (!category) continue;
      const step = await runOneStep({
        baseUrl,
        apiKey,
        poseId,
        modelImage,
        garmentImage: garment.url,
        category,
      });
      lastId = step.taskId;
      lastUrl = step.imageUrl;
      modelImage = step.imageUrl;
    }

    return {
      imageUrl: lastUrl,
      provider: "fashn",
      model: FASHN_MODEL,
      prompt: "",
      taskId: lastId,
    };
  },
};
