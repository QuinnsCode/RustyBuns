// A stand-in eqosys for the journeys: its keys (/.well-known/jwks.json, which the dev server checks tokens against
// through EQOSYS_URL), a /login that signs in whoever `as` names and sends the page back with a code, the code's
// exchange and the refresh a reloaded page renews with. Tokens are signed with its own key, as Park's tests do.
// `signIn` walks a page through "Create your world" against it.
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { type Tab, waitFor } from "../../../scripts/chrome.ts";

export interface Person { id: string; email: string; name: string }

export async function fakeEqosys() {
  const signer = { EQOSYS_SIGNING_KEY: await newKey() };
  let url = "", next: Person | null = null, n = 0;
  const codes = new Map<string, Person>(), refreshes = new Map<string, Person>();
  const handoff = (p: Person, app: string) => ({ user: p, app, source: app, access: ["member"] });
  /** A token for `p`: for Agent Page unless `app` says another, signed `at` (now by default; it lasts ten minutes). */
  const token = async (p: Person, o: { app?: string; at?: number } = {}) => (await sign(signer, url, handoff(p, o.app ?? "agent-page"), o.at ?? Date.now()))!;
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
  const reply = (v: unknown, status = 200) => Response.json(v, { status, headers: cors });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (u.pathname === "/.well-known/jwks.json") return reply(await jwksOf(signer));
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
      return reply({ ...handoff(p, "agent-page"), token: await token(p), refresh });
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
  return { url, token, as: (p: Person) => { next = p; }, stop: () => server.stop(true) };
}

/** A page on the landing presses "Create your world" with eqosys at `eqosys`, signed in there as whoever it names,
 *  and comes back on `/r/<world>`: the room it answers. */
export async function signIn(tab: Tab, eqosys: string): Promise<string> {
  await tab.eval(`localStorage.setItem("agent-page.eqosys", ${JSON.stringify(eqosys)}), document.querySelector(".l-card.c-pink").click()`);
  await waitFor(tab, "back from signing in", `location.pathname.startsWith("/r/") && !!window.agentGalaxy && !!document.querySelector(".dock")`, 30_000);
  return tab.eval<string>(`location.pathname.slice(3)`);
}
