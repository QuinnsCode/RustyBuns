import { ACTIONS, SITES, cell, isAction, type Browser } from "./bench.ts";
import { PAGE } from "./page.ts";

interface Env { BROWSER: Browser }

/** Browser calls one isolate makes before it stops: a stray loop can't run up Chromium time. */
const CAP = 600;
let calls = 0;

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
      if (calls + reps * 2 > CAP) return Response.json({ error: `this isolate has made its ${CAP} browser calls; wait a few minutes and run again` }, { status: 429 });
      calls += reps * 2;
      return Response.json(await cell(env.BROWSER, site, action, reps));
    }
    return new Response("not found", { status: 404 });
  },
};
