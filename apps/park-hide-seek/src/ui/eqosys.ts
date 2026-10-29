// Signing in through eqosys, from the page: send the player to eqosys's /login with a PKCE challenge, and
// when they come back with ?code=&state=, trade it for who they are and a token. The login is kept in
// localStorage; the token is what the Worker checks (src/edge/eqosys.ts), so once it has run out the
// player goes through eqosys again, which is one click when they are still signed in there.
import { b64url, digest } from "@rustybuns/util/bytes";
import { check, obj, str, type Of } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { peek } from "@rustybuns/util/token";
import { APP, EQOSYS, ExchangeReply, SIGN_IN_FROM } from "../api.ts";

/** What the page keeps of a sign-in. */
const Login = obj({ name: str(200), email: str(320), token: str(8192) });
export type Login = Of<typeof Login>;

const kept = {
  get(k: string) { try { return localStorage.getItem(`phs.${k}`) ?? ""; } catch { return ""; } },
  put(k: string, v: string) { try { v ? localStorage.setItem(`phs.${k}`, v) : localStorage.removeItem(`phs.${k}`); } catch {} },
};
/** The handoff's secrets live only in this tab, and only until the player is back. */
const once = {
  take(k: string) { try { const v = sessionStorage.getItem(`phs.eq.${k}`) ?? ""; sessionStorage.removeItem(`phs.eq.${k}`); return v; } catch { return ""; } },
  put(k: string, v: string) { try { sessionStorage.setItem(`phs.eq.${k}`, v); } catch {} },
};

/** Where eqosys is for this page: the live one, or the `phs.eqosys` setting (a local eqosys, `bun run dev` there with loopback returns on). */
export const eqosysUrl = () => (kept.get("eqosys") || EQOSYS).replace(/\/$/, "");
/** Whether eqosys would send a player back here: the online game, or a local eqosys for a page on this machine. */
export const canSignIn = () => SIGN_IN_FROM.includes(location.origin) || !!kept.get("eqosys");
/** The page without the handoff's query, where eqosys sends the player back. */
const here = () => `${location.origin}${location.pathname}`;

/** Off to eqosys. `then` is what the player was doing ("play"), picked up again when they come back. */
export async function signIn(then = ""): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  once.put("verifier", verifier); once.put("state", state); once.put("then", then);
  const q = new URLSearchParams({ app: APP, return: here(), challenge: b64url(await digest(verifier)), state });
  location.assign(`${eqosysUrl()}/login?${q}`);
}

export interface Returned { login: Login | null; then: string; error?: string }

/**
 * Back from eqosys with ?code=&state=: trade the code in and keep the login. Answers what to carry on with, or
 * null when this wasn't a return. The query is taken off the address either way, so a reload doesn't retry it.
 */
export async function finishSignIn(): Promise<Returned | null> {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state");
  if (code === null || state === null) return null;
  q.delete("code"); q.delete("state");
  history.replaceState(null, "", `${location.pathname}${q.size ? "?" + q : ""}${location.hash}`);
  const verifier = once.take("verifier"), then = once.take("then");
  if (!verifier || state !== once.take("state")) return { login: null, then, error: "That sign-in didn't start here. Try again." };
  const got = await getJson(`${eqosysUrl()}/api/exchange`, ExchangeReply, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: APP, code, verifier }) });
  if (!got) return { login: null, then, error: "eqosys didn't let that sign-in through. Try again." };
  if (!got.token) return { login: null, then, error: "eqosys isn't handing out tokens yet, so you can't sign in here. Play with a name for now." };
  const login: Login = { name: got.user.name, email: got.user.email, token: got.token };
  kept.put("login", JSON.stringify(login));
  return { login, then };
}

/** The login kept from the last sign-in, if any. Its token may have run out: see `fresh`. */
export function login(): Login | null {
  try { return check(Login, JSON.parse(kept.get("login") || "null")); } catch { return null; }
}

/** Whether the token still has `forMs` to run: long enough for the server to check it when the request lands. */
export const fresh = (l: Login, forMs = 30_000, now = Date.now()) => (peek(l.token)?.exp ?? 0) * 1000 > now + forMs;

export function signOut() { kept.put("login", ""); }
