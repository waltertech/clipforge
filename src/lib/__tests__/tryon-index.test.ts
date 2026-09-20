import { describe, expect, it, vi } from "vitest";
import { composeRoute, fashnRoute, getTryOnRoute, listTryOnRoutes, registerTryOnRoute } from "@/lib/tryon";
import type { TryOnRoute } from "@/lib/tryon/types";

describe("试衣路线注册表", () => {
  it("缺省与 compose id 都解析到 compose 路线", () => {
    expect(getTryOnRoute(undefined)).toBe(composeRoute);
    expect(getTryOnRoute("compose")).toBe(composeRoute);
    expect(getTryOnRoute("compose").id).toBe("compose");
  });

  it("vton 解析到 FASHN 路线", () => {
    expect(getTryOnRoute("vton")).toBe(fashnRoute);
    expect(getTryOnRoute("vton").id).toBe("vton");
    expect(getTryOnRoute("vton").displayName).toEqual({ zh: "FASHN 试衣", en: "FASHN try-on" });
    expect(listTryOnRoutes().map((r) => r.id)).toEqual(expect.arrayContaining(["compose", "vton"]));
  });

  it("未知 id 回退到 compose，且只 warn 一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTryOnRoute("nope")).toBe(composeRoute);
    expect(getTryOnRoute("nope")).toBe(composeRoute);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("nope");
    warn.mockRestore();
  });

  it("registerTryOnRoute 可以覆盖已注册路线", () => {
    const fake: TryOnRoute = {
      id: "vton",
      displayName: { zh: "占位", en: "stub" },
      supports: () => true,
      generateLook: async () => {
        throw new Error("not implemented");
      },
    };
    registerTryOnRoute(fake);
    expect(getTryOnRoute("vton")).toBe(fake);
    registerTryOnRoute(fashnRoute);
    expect(getTryOnRoute("vton")).toBe(fashnRoute);
    expect(getTryOnRoute("compose")).toBe(composeRoute);
  });
});
