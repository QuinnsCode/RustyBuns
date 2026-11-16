import { ACTIONS, ENGINES, SITES, burst, cell, isAction, raw, type Browser, type Engine } from "./bench.ts";
import { PAGE } from "./page.ts";

interface Env { BROWSER: Browser }

/** Browser calls one isolate makes before it stops: a stray loop can't run up Chromium time. */
const CAP = 600;
let calls = 0;
/** Calls per engine in one burst: Browser Run takes 30 Quick Actions a second on Workers Paid. */
const BURST_MAX = 20;
const isEngine = (x: unknown): x is Engine => ENGINES.some((e) => e === x);
const capped = () => Response.json({ error: `this isolate has made its ${CAP} browser calls; wait a few minutes and run again` }, { status: 429 });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/sites") return Response.json({ sites: SITES, actions: ACTIONS });
    if (url.pathname === "/cell") {
      const site = Number(url.searchParams.get("site"));
      const action = url.searchParams.get("action");
      const reps = Math.min(5, Math.max(1, Number(url.searchParams.get("reps")) || 3));
      if (!Number.isInteger(site) || !SITES[site]) return Response.json({ error: "site is an index into /sites" }, { status: 400 });
      if (!isAction(action)) return Response.json({ error: `action is one of ${ACTIONS.join(", ")}` }, { status: 400 });
      if (calls + reps * 2 > CAP) return capped();
      calls += reps * 2;
      return Response.json(await cell(env.BROWSER, site, action, reps));
    }
    if (url.pathname === "/burst" || url.pathname === "/shot") {
      const site = Number(url.searchParams.get("site"));
      if (!Number.isInteger(site) || !SITES[site]) return Response.json({ error: "site is an index into /sites" }, { status: 400 });
      const page = SITES[site].url;
      if (url.pathname === "/shot") {
        const engine = url.searchParams.get("engine");
        if (!isEngine(engine)) return Response.json({ error: `engine is one of ${ENGINES.join(", ")}` }, { status: 400 });
        if (calls + 1 > CAP) return capped();
        calls += 1;
        const r = await raw(env.BROWSER, engine, "screenshot", page);
        return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "image/png" } });
      }
      const action = url.searchParams.get("action");
      const n = Math.min(BURST_MAX, Math.max(1, Number(url.searchParams.get("n")) || 10));
      if (!isAction(action)) return Response.json({ error: `action is one of ${ACTIONS.join(", ")}` }, { status: 400 });
      if (calls + n * 2 > CAP) return capped();
      calls += n * 2;
      // One engine at a time, so the two never share Browser Run's 30-a-second limit.
      const kitesurf = await burst(env.BROWSER, "kitesurf", action, page, n);
      const chromium = await burst(env.BROWSER, "chromium", action, page, n);
      return Response.json({ site: SITES[site].name, action, n, kitesurf, chromium });
    }
    return new Response("not found", { status: 404 });
  },
};
