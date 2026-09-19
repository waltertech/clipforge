/**
 * Try-on route registry. M1 ships only the compose route; later milestones
 * call `registerTryOnRoute` to add vton (FASHN) without changing callers.
 */
import { composeRoute } from "./compose-route";
import type { TryOnRoute } from "./types";

const routes = new Map<string, TryOnRoute>();
routes.set(composeRoute.id, composeRoute);

const warnedFallback = new Set<string>();

export function registerTryOnRoute(route: TryOnRoute): void {
  routes.set(route.id, route);
}

export function listTryOnRoutes(): TryOnRoute[] {
  return Array.from(routes.values());
}

/**
 * Resolve a route by id. Unknown or not-yet-registered ids (e.g. "vton" in M1)
 * fall back to compose and warn once per id so a later agent can register it.
 */
export function getTryOnRoute(id: string | undefined): TryOnRoute {
  if (id) {
    const found = routes.get(id);
    if (found) return found;
    if (!warnedFallback.has(id)) {
      warnedFallback.add(id);
      console.warn(`[tryon] 未注册的路线 "${id}"，回退到 compose`);
    }
  }
  return composeRoute;
}

export { composeRoute };
