// The API. GET /api/fleet: every stack and stage hemyviz can see, cut down to what is safe to draw (read.ts).
// `?since=<version>` answers 204 while nothing on disk changed, so the page can ask every couple of seconds for free.
// Read-only: hemyviz never writes state and never talks to a cloud account.
import { privateJson } from "@rustybuns/util/http";
import type { Fleet } from "./api.ts";

/** The handler for /api/*, reading the fleet through `read` on each ask (a scan is a few stat calls per file). */
export function api(read: () => Fleet) {
  return (req: Request): Response => {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") return privateJson({ ok: true });
    if (url.pathname !== "/api/fleet" || req.method !== "GET") return privateJson({ error: "not found" }, 404);
    const fleet = read() satisfies Fleet;
    if (url.searchParams.get("since") === fleet.version) return new Response(null, { status: 204 });
    return privateJson(fleet);
  };
}
