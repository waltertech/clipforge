import { afterEach, describe, expect, it, vi } from "vitest";
import { getPosePreset } from "@/lib/pose-presets";
import { fashnRoute, mapFashnCategory, setFashnFetch } from "@/lib/tryon/fashn-route";
import { TryOnRouteError, type LookRequest } from "@/lib/tryon/types";

const pose = getPosePreset("front_stand")!;

function req(overrides: Partial<LookRequest> = {}): LookRequest {
  return {
    modelRefs: ["https://cdn.example/model.png"],
    garments: [{ url: "https://cdn.example/top.png", category: "tops", view: "flat" }],
    pose,
    aspect: "3:4",
    lock: { face: true, garmentPattern: true },
    lang: "zh",
    ...overrides,
  };
}

const ctx = {
  providerConfig: { name: "fashn", apiKey: "unused", baseUrl: "" },
  settings: { fashn: { apiKey: "sk-fashn", baseUrl: "https://api.fashn.ai/v1" } },
};

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function runBody(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

afterEach(() => {
  setFashnFetch(null);
});

describe("mapFashnCategory", () => {
  it("maps outerwear to tops and leaves the rest 1:1", () => {
    expect(mapFashnCategory("tops")).toBe("tops");
    expect(mapFashnCategory("bottoms")).toBe("bottoms");
    expect(mapFashnCategory("one-pieces")).toBe("one-pieces");
    expect(mapFashnCategory("outerwear")).toBe("tops");
    expect(mapFashnCategory("shoes")).toBeNull();
    expect(mapFashnCategory("accessory")).toBeNull();
  });
});

describe("fashnRoute.supports", () => {
  it("returns false when any category is shoes or accessory", () => {
    expect(fashnRoute.supports(["tops", "bottoms"])).toBe(true);
    expect(fashnRoute.supports(["outerwear"])).toBe(true);
    expect(fashnRoute.supports(["shoes"])).toBe(false);
    expect(fashnRoute.supports(["tops", "accessory"])).toBe(false);
  });
});

describe("fashnRoute.generateLook", () => {
  it("maps outerwear → tops on /run", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/run")) {
        return jsonRes(200, { id: "job-1" });
      }
      return jsonRes(200, { status: "completed", output: ["https://cdn.example/out.png"] });
    });
    setFashnFetch(fetchMock as unknown as typeof fetch);

    await fashnRoute.generateLook(req({ garments: [{ url: "https://g/coat.png", category: "outerwear", view: "flat" }] }), ctx);

    const runCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/run"));
    expect(runCall).toBeTruthy();
    const body = runBody(runCall!) as { model_name: string; inputs: { category: string; garment_image: string; model_image: string } };
    expect(body.model_name).toBe("tryon-v1.6");
    expect(body.inputs.category).toBe("tops");
    expect(body.inputs.garment_image).toBe("https://g/coat.png");
    expect(body.inputs.model_image).toBe("https://cdn.example/model.png");
  });

  it("two garments: second /run uses the first output as model_image", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/run")) {
        const payload = JSON.parse(String(init?.body));
        const id = payload.inputs.garment_image.includes("top") ? "job-a" : "job-b";
        return jsonRes(200, { id });
      }
      if (url.endsWith("/status/job-a")) {
        return jsonRes(200, { status: "completed", output: ["https://cdn.example/step1.png"] });
      }
      return jsonRes(200, { status: "completed", output: ["https://cdn.example/step2.png"] });
    });
    setFashnFetch(fetchMock as unknown as typeof fetch);

    const result = await fashnRoute.generateLook(
      req({
        garments: [
          { url: "https://g/top.png", category: "tops", view: "flat" },
          { url: "https://g/coat.png", category: "outerwear", view: "flat" },
        ],
      }),
      ctx
    );

    const runBodies = fetchMock.mock.calls
      .filter((c) => String(c[0]).endsWith("/run"))
      .map((c) => runBody(c) as { inputs: { model_image: string; garment_image: string } });
    expect(runBodies).toHaveLength(2);
    expect(runBodies[0].inputs.model_image).toBe("https://cdn.example/model.png");
    expect(runBodies[0].inputs.garment_image).toBe("https://g/top.png");
    expect(runBodies[1].inputs.model_image).toBe("https://cdn.example/step1.png");
    expect(runBodies[1].inputs.garment_image).toBe("https://g/coat.png");
    expect(result.imageUrl).toBe("https://cdn.example/step2.png");
    expect(result.provider).toBe("fashn");
    expect(result.model).toBe("tryon-v1.6");
    expect(result.prompt).toBe("");
    expect(result.taskId).toBe("job-b");
  });

  it("HTTP 401 is a non-retryable TryOnRouteError", async () => {
    setFashnFetch(async () => jsonRes(401, { error: "unauthorized" }));
    try {
      await fashnRoute.generateLook(req(), ctx);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TryOnRouteError);
      const e = err as TryOnRouteError;
      expect(e.retryable).toBe(false);
      expect(e.route).toBe("vton");
      expect(e.message).toBe("FASHN API Key 无效或未配置");
    }
  });

  it("HTTP 500 is retryable", async () => {
    setFashnFetch(async () => jsonRes(500, { error: "boom" }));
    try {
      await fashnRoute.generateLook(req(), ctx);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TryOnRouteError);
      const e = err as TryOnRouteError;
      expect(e.retryable).toBe(true);
      expect(e.route).toBe("vton");
    }
  });

  it("failed status raises an error", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/run")) return jsonRes(200, { id: "job-fail" });
      return jsonRes(200, { status: "failed", error: "garment parse error" });
    });
    setFashnFetch(fetchMock as unknown as typeof fetch);
    await expect(fashnRoute.generateLook(req(), ctx)).rejects.toMatchObject({
      name: "TryOnRouteError",
      message: "garment parse error",
      route: "vton",
    });
  });

  it("success returns the last output url", async () => {
    setFashnFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/run")) return jsonRes(200, { id: "ok-1" });
      return jsonRes(200, { status: "completed", output: ["https://cdn.example/final.png"] });
    }) as unknown as typeof fetch);
    const result = await fashnRoute.generateLook(req(), ctx);
    expect(result.imageUrl).toBe("https://cdn.example/final.png");
    expect(result.taskId).toBe("ok-1");
  });
});
