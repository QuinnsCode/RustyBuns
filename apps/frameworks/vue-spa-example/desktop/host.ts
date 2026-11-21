// Your desktop backend. Runs in the Bun host next to your built SPA.
// Return a Response for routes you own, null for everything else.
import type { HostContext } from "@rustybuns/shell-bun";

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname === "/api/hello") return Response.json({ hello: ctx.identity["X-User-Name"], dataDir: ctx.dataDir });
    return null;
  },
};
