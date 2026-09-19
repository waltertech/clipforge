import { describe, expect, it, vi } from "vitest";
import { composeRoute, getTryOnRoute, listTryOnRoutes, registerTryOnRoute } from "@/lib/tryon";
import type { TryOnRoute } from "@/lib/tryon/types";

describe("试衣路线注册表", () => {
  it("缺省与 compose id 都解析到 compose 路线", () => {
    expect(getTryOnRoute(undefined)).toBe(composeRoute);
    expect(getTryOnRoute("compose")).toBe(composeRoute);
    expect(getTryOnRoute("compose").id).toBe("compose");
  });

  it("未知 id 回退到 compose，且只 warn 一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTryOnRoute("nope")).toBe(composeRoute);
    expect(getTryOnRoute("nope")).toBe(composeRoute);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("nope");
    warn.mockRestore();
  });

  it("registerTryOnRoute 之后可以解析到自定义 vton 路线", () => {
    const fakeVton: TryOnRoute = {
      id: "vton",
      displayName: { zh: "精确试衣", en: "VTON" },
      supports: () => true,
      generateLook: async () => {
        throw new Error("not implemented");
      },
    };
    expect(listTryOnRoutes().some((r) => r.id === "vton")).toBe(false);
    registerTryOnRoute(fakeVton);
    expect(getTryOnRoute("vton")).toBe(fakeVton);
    expect(listTryOnRoutes().map((r) => r.id)).toContain("vton");
    expect(getTryOnRoute("compose")).toBe(composeRoute);
  });
});
