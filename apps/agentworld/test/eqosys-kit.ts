// A stand-in eqosys for the journeys: its keys (/.well-known/jwks.json, which the dev server checks tokens against
// through EQOSYS_URL), a /login that signs in whoever `as` names and sends the page back with a code, the code's
// exchange, the refresh a reloaded page renews with, and /q/achieve (the ids asked for, in `unlocked`). Tokens are signed with its own key, as Park's tests do.
// `signIn` walks a page through "Create your world" against it.
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { type Tab, waitFor } from "../../../scripts/chrome.ts";

export interface Person { id: string; email: string; name: string }

export async function fakeEqosys() {
  const signer = { EQOSYS_SIGNING_KEY: await newKey() };
  let url = "", next: Person | null = null, n = 0;
  const unlocked = new Set<string>();
  const codes = new Map<string, Person>(), refreshes = new Map<string, Person>();
  const handoff = (p: Person, app: string) => ({ user: p, app, source: app, access: ["member"] });
  /** A token for `p`: for Agent World unless `app` says another, signed `at` (now by default; it lasts ten minutes). */
  const token = async (p: Person, o: { app?: string; at?: number } = {}) => (await sign(signer, url, handoff(p, o.app ?? "agentworld"), o.at ?? Date.now()))!;
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, dpop", "access-control-allow-methods": "GET, POST, OPTIONS" };
  const reply = (v: unknown, status = 200) => Response.json(v, { status, headers: cors });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (u.pathname === "/.well-known/jwks.json") return reply(await jwksOf(signer));
    if (u.pathname === "/q/achieve") {
      const body: unknown = await req.json().catch(() => null);
      if (!req.headers.get("authorization") || !body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") return reply({ error: "send { id } with a token" }, 400);
      const fresh = !unlocked.has(body.id);
      unlocked.add(body.id);
      return reply({ achievement: { id: body.id, name: body.id, blurb: body.id, secret: false, at: Date.now() }, new: fresh });
    }
    if (u.pathname === "/health") return new Response("ok", { headers: cors });
    if (u.pathname === "/login" && next) {
      const code = `code${++n}`, back = new URL(u.searchParams.get("return") ?? "");
      codes.set(code, next);
      back.searchParams.set("code", code);
      back.searchParams.set("state", u.searchParams.get("state") ?? "");
      return Response.redirect(back.href, 302);
    }
    if (u.pathname === "/api/exchange") {
      const body: unknown = await req.json().catch(() => null);
      const p = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? codes.get(body.code) : undefined;
      if (!p) return reply({ error: "no such code" }, 400);
      const refresh = `refresh${++n}`;
      refreshes.set(refresh, p);
      return reply({ ...handoff(p, "agentworld"), token: await token(p), refresh });
    }
    if (u.pathname === "/oauth/token") {
      const was = new URLSearchParams(await req.text()).get("refresh_token") ?? "", p = refreshes.get(was);
      if (!p) return reply({ error: "invalid_grant" }, 400);
      refreshes.delete(was);
      const refresh = `refresh${++n}`;
      refreshes.set(refresh, p);
      return reply({ access_token: await token(p), refresh_token: refresh });
    }
    return reply({ error: "not here" }, 404);
  } });
  url = `http://127.0.0.1:${server.port}`;
  return { url, token, unlocked, as: (p: Person) => { next = p; }, stop: () => server.stop(true) };
}

/** A page on the landing presses "Create your world" with eqosys at `eqosys`, signed in there as whoever it names,
 *  and comes back on `/r/<world>`: the room it answers. */
export async function signIn(tab: Tab, eqosys: string): Promise<string> {
  // The page's mount is forked: window.agentGalaxy can be up before the landing is drawn.
  await waitFor(tab, "the Create your world button", `!!document.querySelector(".l-create")`, 30_000);
  await tab.eval(`localStorage.setItem("agentworld.eqosys",${JSON.stringify(eqosys)}), document.querySelector(".l-create").click()`);
  await waitFor(tab, "back from signing in", `location.pathname.startsWith("/r/") && !!window.agentGalaxy && !!document.querySelector(".dock")`, 30_000);
  return tab.eval<string>(`location.pathname.slice(3)`);
}

/** Draw a scrawl on the signature pad that is up, with real mouse or touch input. */
export async function scrawlOnPad(tab: Tab, touch = false): Promise<void> {
  await waitFor(tab, "the signature pad", `!!document.querySelector(".sign-screen canvas")`, 30_000);
  const r = await tab.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const b = document.querySelector(".sign-screen canvas").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
  const at = Array.from({ length: 24 }, (_, i) => ({ x: r.x + r.w * (0.12 + i * 0.03), y: r.y + r.h * (0.45 + 0.25 * Math.sin(i * 0.7)) }));
  const [first, ...rest] = at;
  if (touch) {
    await tab.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
    for (const p of rest) await tab.call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    await tab.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return;
  }
  const mouse = (type: string, p: { x: number; y: number }) => tab.call("Input.dispatchMouseEvent", { type, ...p, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  await mouse("mousePressed", first!);
  for (const p of rest) await mouse("mouseMoved", p);
  await mouse("mouseReleased", rest.at(-1)!);
}

/** `agentGalaxy.enter()`, signing at the pad first when it asks (a first visit). */
export async function enterSigned<T>(tab: Tab): Promise<T> {
  const enter = () => tab.eval<T & { signing?: boolean }>(`agentGalaxy.enter()`);
  const first = await enter();
  if (!first.signing) return first;
  await scrawlOnPad(tab);
  await tab.eval(`document.querySelector(".sign-done").click()`);
  await waitFor(tab, "the pad to go", `!agentGalaxy.state().signing`, 15_000);
  return enter();
}
