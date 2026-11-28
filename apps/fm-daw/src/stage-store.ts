// The Stage Builder's builds and orders on the owner's account (#6583), in the same Durable Object as their parties
// (party-store.ts), behind the same token check. Each build is a stored value of its own, in one of MAX_BUILDS slots,
// so a full store (about 1.7 MB: 8 builds of 60 saves of a 16 stack rig) never nears one value's 2 MB.
import { arr, check, int, obj } from "@rustybuns/util/guard";
import { json, privateJson } from "@rustybuns/util/http";
import { Build, MAX_BUILDS, Order, shelf, Shelf, ShelfSent, type StageReply } from "./studio/stage-build.ts";
import type { Storage } from "./party-store.ts";

/** Characters a saved store may take on the way in. */
export const STAGE_MAX = 3_000_000;

const Index = obj({ builds: int(0, MAX_BUILDS), orders: arr(Order, Infinity, { drop: true }) });
const slot = (i: number) => `stage:build:${i}`;

async function kept(storage: Storage): Promise<Shelf> {
  const index = check(Index, await storage.get("stage"));
  if (!index) return { builds: [], orders: [] };
  const builds = await Promise.all(Array.from({ length: index.builds }, (_, i) => storage.get(slot(i))));
  return shelf(check(Shelf, { builds, orders: index.orders }) ?? { builds: [], orders: [] });
}

/** `/stage-builds` (GET, PUT) for the store of `owner`. */
export async function stageStore(storage: Storage, req: Request, owner: string): Promise<Response> {
  if (req.method === "GET") return privateJson({ owner, store: await kept(storage) } satisfies StageReply);
  if (req.method !== "PUT") return json({ error: "GET or PUT" }, 405);
  const text = await req.text();
  if (text.length > STAGE_MAX) return json({ error: "too big" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
  const store = check(ShelfSent, body);
  if (!store) return json({ error: "that isn't a Stage Builder store" }, 400);
  // asked for together with nothing awaited between, so they land as one write
  await Promise.all([
    storage.put("stage", { builds: store.builds.length, orders: store.orders }),
    ...store.builds.map((b: Build, i) => storage.put(slot(i), b)),
  ]);
  return privateJson({ owner, store } satisfies StageReply);
}
