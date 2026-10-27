// A host with one module global, as RB_EDGE_LIKE would run a Worker: it counts requests and says which process answered.
import { serve, recycling, restartHost, edgeLike } from "../../src/index.ts";

let hits = 0;
const shell = serve({ hostname: "127.0.0.1", port: Number(process.env.RB_LISTEN?.split(":")[1] ?? 0) });
shell.mount({ fetch: recycling(edgeLike()?.recycleAfter ?? 0, () => restartHost(shell), async () => Response.json({ hits: ++hits, pid: process.pid })) }, {});
console.log(`serving ${shell.url}`);
