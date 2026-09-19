/**
 * Try-on route registry. Compose is the default; FASHN registers as "vton".
 * Unknown ids fall back to compose (with a one-shot warning).
 */
import { composeRoute } from "./compose-route";
import { fashnRoute } from "./fashn-route";
import type { TryOnRoute } from "./types";

const routes = new Map<string, TryOnRoute>();
routes.set(composeRoute.id, composeRoute);
routes.set(fashnRoute.id, fashnRoute);

const warnedFallback = new Set<string>();

export function registerTryOnRoute(route: TryOnRoute): void {
  routes.set(route.id, route);
}

export function listTryOnRoutes(): TryOnRoute[] {
  return Array.from(routes.values());
}

/**
 * Resolve a route by id. Unknown ids fall back to compose and warn once per id.
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

export { composeRoute, fashnRoute };
