// A game page signs in through eqosys in a real browser (#5892): the token stays in memory, IndexedDB keeps who it was
// with a refresh token bound to the page's non-extractable key, localStorage keeps nothing of it, and a reload comes
// back signed in by renewing with a proof from that same key, across origins (so the DPoP header passes CORS).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { checkDpop, newKey, sign } from "../src/token.ts";

setDefaultTimeout(60_000);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "vault-page.ts")], target: "browser" });
const script = await built.outputs[0]!.text();
const game = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => new URL(req.url).pathname === "/page.js"
  ? new Response(script, { headers: { "content-type": "text/javascript" } })
  : new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/page.js"></script>`, { headers: { "content-type": "text/html" } }) });
const GAME = `http://127.0.0.1:${game.port}`;

// The stand-in eqosys, on another origin: /login sends the player straight back with a code, and every POST is checked for a proof.
const key = { EQOSYS_SIGNING_KEY: await newKey() };
const ada = { user: { id: "u_ada", email: "ada@example.com", name: "Ada" }, app: "game", source: "game", access: ["play"] };
const proofs: string[] = [];
let refreshes = 0;
const cors = { "access-control-allow-origin": GAME, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type, authorization, dpop" };
const eq = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (url.pathname === "/login") return Response.redirect(`${url.searchParams.get("return")}?code=eq_1&state=${url.searchParams.get("state")}`, 302);
  const jkt = await checkDpop(req.headers.get("dpop"), "POST", req.url);
  if (jkt) proofs.push(jkt);
  const token = await sign(key, "http://eqosys", ada);
  if (url.pathname === "/api/exchange") return Response.json({ ...ada, token, refresh: `r${++refreshes}` }, { headers: cors });
  if (url.pathname === "/oauth/token") return Response.json({ access_token: token, refresh_token: `r${++refreshes}` }, { headers: cors });
  return new Response("", { status: 404, headers: cors });
} });
const PAGE = `${GAME}/?eq=${encodeURIComponent(`http://127.0.0.1:${eq.port}`)}`;

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); game.stop(true); eq.stop(true); });

const until = async (ok: () => Promise<boolean>) => { for (let i = 0; i < 100 && !await ok(); i++) await Bun.sleep(100); };

test("signed in, nothing of it in localStorage; reloaded, still signed in by a renewal the page's own key proves", async () => {
  const tab = await openTab(chrome.cdp, { w: 800, h: 600 }, false, true);
  await load(chrome.cdp, tab, PAGE, 300);
  expect(await tab.eval<boolean>("t.back.then(() => t.eq.login() === null)")).toBe(true);
  await tab.eval("void t.eq.signIn()");
  await until(() => tab.eval<boolean>(`!!window.t && t.back.then(() => t.eq.login()?.name === "Ada")`).catch(() => false));
  expect(await tab.eval<string>("t.eq.login()?.name")).toBe("Ada");
  expect(await tab.eval<string>("t.stored()")).not.toContain("refresh");
  expect(await tab.eval<string>("t.stored()")).not.toContain("token");
  expect(await tab.eval<unknown>("t.kept()")).toEqual({ login: { name: "Ada", email: "ada@example.com", refresh: "r1" }, extractable: false });

  await load(chrome.cdp, tab, PAGE, 300);
  expect(await tab.eval<boolean>("t.eq.ready.then(() => t.eq.fresh(t.eq.login()))")).toBe(true);
  expect(proofs.length).toBe(2); // the code traded, then the renewal on reload
  expect(new Set(proofs).size).toBe(1); // both from the one key the page made and kept
  expect(await tab.eval<unknown>("t.kept()")).toMatchObject({ login: { refresh: "r2" } });
  await tab.close();
});
