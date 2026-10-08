// App routes on the desktop host. The page needs the machine's LAN address to
// tell friends where to join; the browser can't see it, the host can.
//
//   GET /api/lan   { addresses: ["192.168.1.20", ...], port }
import type { HostContext } from "@rustybuns/shell-bun";
import { networkInterfaces } from "node:os";

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname !== "/api/lan") return null;
    const addresses: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) addresses.push(a.address);
    }
    return Response.json({ addresses, port: ctx.shell.port });
  },
};
