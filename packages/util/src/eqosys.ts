// Signing in through eqosys, from a page: send the player to eqosys's /login with a PKCE challenge, and
// when they come back with ?code=&state=, trade it for who they are and a token. The login is kept in
// localStorage; the token is what the app's Worker checks (`TokenChecker` from ./token), so once it has
// run out the player goes through eqosys again, which is one click when they are still signed in there.
// Worked example: apps/park-hide-seek/src/ui/eqosys.ts.
import { b64url, digest } from "./bytes.ts";
import { arr, bool, check, int, nul, obj, oneOf, str, type Guard, type Of } from "./guard.ts";
import { getJson } from "./http.ts";
import { connectSocket, type Link } from "./socket.ts";
import { mountReportButton, sendReport, type ReportIn, type Sent } from "./report.ts";
import { peek } from "./token.ts";

/** What the page keeps of a sign-in. */
export const Login = obj({ name: str(200), email: str(320), token: str(8192) });
export type Login = Of<typeof Login>;

/** POST eqosys /api/exchange: who signed in, and the token the Worker checks. `token` is null while eqosys has no signing key. */
export const ExchangeReply = obj({
  user: obj({ id: str(200), email: str(320), name: str(200) }),
  app: str(64), source: str(64), access: arr(str(32), 100), token: nul(str(8192)),
});
export type ExchangeReply = Of<typeof ExchangeReply>;

export interface Returned { login: Login | null; then: string; error?: string }

export interface EqosysConfig {
  /** This app's id in eqosys's APPS. */
  app: string;
  /** Where eqosys lives. */
  url: string;
  /** The origins eqosys sends players back to. Any other page (a desktop app, a LAN host) keeps the typed name. */
  from: readonly string[];
  /** Prefix for what is kept in localStorage (`<prefix>.login`, `<prefix>.eqosys`) and sessionStorage. */
  prefix: string;
}

/** The sign-in client for one app. `signIn`, `finishSignIn`, `login`, `fresh`, `signOut`, `eqosysUrl`, `canSignIn`. */
export function eqosys({ app, url, from, prefix }: EqosysConfig) {
  const kept = {
    get(k: string) { try { return localStorage.getItem(`${prefix}.${k}`) ?? ""; } catch { return ""; } },
    put(k: string, v: string) { try { v ? localStorage.setItem(`${prefix}.${k}`, v) : localStorage.removeItem(`${prefix}.${k}`); } catch {} },
  };
  /** The handoff's secrets live only in this tab, and only until the player is back. */
  const once = {
    take(k: string) { try { const v = sessionStorage.getItem(`${prefix}.eq.${k}`) ?? ""; sessionStorage.removeItem(`${prefix}.eq.${k}`); return v; } catch { return ""; } },
    put(k: string, v: string) { try { sessionStorage.setItem(`${prefix}.eq.${k}`, v); } catch {} },
  };

  /** Where eqosys is for this page: the live one, or the `<prefix>.eqosys` setting (a local eqosys, `bun run dev` there with loopback returns on). */
  const eqosysUrl = () => (kept.get("eqosys") || url).replace(/\/$/, "");
  /** Whether eqosys would send a player back here: the online game, or a local eqosys for a page on this machine. */
  const canSignIn = () => from.includes(location.origin) || !!kept.get("eqosys");
  /** The page without the handoff's query, where eqosys sends the player back. */
  const here = () => `${location.origin}${location.pathname}`;

  /** Off to eqosys. `then` is what the player was doing ("play"), picked up again when they come back. */
  async function signIn(then = ""): Promise<void> {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    once.put("verifier", verifier); once.put("state", state); once.put("then", then);
    const q = new URLSearchParams({ app, return: here(), challenge: b64url(await digest(verifier)), state });
    location.assign(`${eqosysUrl()}/login?${q}`);
  }

  /**
   * Back from eqosys with ?code=&state=: trade the code in and keep the login. Answers what to carry on with, or
   * null when this wasn't a return. The query is taken off the address either way, so a reload doesn't retry it.
   */
  async function finishSignIn(): Promise<Returned | null> {
    const q = new URLSearchParams(location.search);
    const code = q.get("code"), state = q.get("state");
    if (code === null || state === null) return null;
    q.delete("code"); q.delete("state");
    history.replaceState(null, "", `${location.pathname}${q.size ? "?" + q : ""}${location.hash}`);
    const verifier = once.take("verifier"), then = once.take("then");
    if (!verifier || state !== once.take("state")) return { login: null, then, error: "That sign-in didn't start here. Try again." };
    const got = await getJson(`${eqosysUrl()}/api/exchange`, ExchangeReply, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app, code, verifier }) });
    if (!got) return { login: null, then, error: "eqosys didn't let that sign-in through. Try again." };
    if (!got.token) return { login: null, then, error: "eqosys isn't handing out tokens yet, so you can't sign in here. Play with a name for now." };
    const login: Login = { name: got.user.name, email: got.user.email, token: got.token };
    kept.put("login", JSON.stringify(login));
    return { login, then };
  }

  /** The login kept from the last sign-in, if any. Its token may have run out: see `fresh`. */
  function login(): Login | null {
    try { return check(Login, JSON.parse(kept.get("login") || "null")); } catch { return null; }
  }

  /** Whether the token still has `forMs` to run: long enough for the server to check it when the request lands. */
  const fresh = (l: Login, forMs = 30_000, now = Date.now()) => (peek(l.token)?.exp ?? 0) * 1000 > now + forMs;

  function signOut() { kept.put("login", ""); }

  /** Send a bug report, suggestion or error to the RustyBuns repo through eqosys (needs a fresh login). */
  const report = async (r: ReportIn): Promise<Sent> => {
    const l = login();
    return l && fresh(l, 5_000) ? sendReport(eqosysUrl(), l.token, r) : { ok: false, error: "Sign in with eqosys first." };
  };
  /** A corner "Report" button for the page, only where eqosys can send the player back. Signed out, it sends them through eqosys. */
  const reportButton = (build?: string) => !canSignIn() ? () => {} : mountReportButton({ token: () => { const l = login(); return l && fresh(l, 5_000) ? l.token : null; }, url: eqosysUrl, signIn: () => void signIn("report"), build });

  /** A Qollab party client for this app, signed with the kept login. See `party`. */
  const partyClient = () => party({ url: eqosysUrl, token: () => { const l = login(); return l && fresh(l, 5_000) ? l.token : null; } });

  return { signIn, finishSignIn, login, fresh, signOut, eqosysUrl, canSignIn, report, reportButton, party: partyClient };
}

/** A member of a party as eqosys's party shows them. */
export const PartyMember = obj({ id: str(200), name: str(200), ready: bool(false), host: bool(false) });
export type PartyMember = Of<typeof PartyMember>;
/** What a party says: who is in, that the host started (go to `room`, sit in `seat`), or why a request was refused. */
export const PartyMsg: Guard<{ t: "members"; members: PartyMember[] } | { t: "start"; room: string; seat: number } | { t: "refused"; why: string }> = (v) => {
  const t = check(obj({ t: oneOf(["members", "start", "refused"]) }), v)?.t;
  if (t === "members") return { t, members: obj({ members: arr(PartyMember, 1000) })(v).members };
  if (t === "start") return { t, ...obj({ room: str(64), seat: int(0, 1000) })(v) };
  if (t === "refused") return { t, why: obj({ why: str(500) })(v).why };
  throw new Error("not a party message");
};
export type PartyMsg = Of<typeof PartyMsg>;

export interface PartyConfig {
  /** Where eqosys is. */
  url: () => string;
  /** A fresh token for this app, or null when signed out. */
  token: () => string | null;
}

/**
 * The page's side of a Qollab party (apps/eqosys, QOLLAB.md): `make()` a code, `join(code)`, `ready(bool)`, and the host's
 * `start()`. Everyone hears `onStart({ room, seat })` and carries on in their own world. `onMembers` hears who is in and who is ready.
 */
export function party({ url, token }: PartyConfig) {
  let link: Link<{ t: string; ready?: boolean }> | null = null;
  let onStart: (s: { room: string; seat: number }) => void = () => {};
  let onMembers: (m: PartyMember[]) => void = () => {};
  let onRefused: (why: string) => void = () => {};
  let onGone: (why: string) => void = () => {};

  /** A new party's code, or null when signed out or eqosys refused (too many parties just now, say). */
  async function make(): Promise<string | null> {
    const t = token();
    if (!t) return null;
    const got = await getJson(`${url()}/q/party`, obj({ code: str(12) }), { method: "POST", headers: { authorization: `Bearer ${t}` } });
    return got?.code ?? null;
  }

  /** Open the party's socket. `onGone` hears "no such party" or any close that isn't a retry. */
  function join(code: string) {
    const t = token();
    if (!t) { onGone("Sign in with eqosys first."); return; }
    link?.close();
    link = connectSocket<PartyMsg, { t: string; ready?: boolean }>(() => `${url().replace(/^http/, "ws")}/q/party/${encodeURIComponent(code)}?token=${encodeURIComponent(t)}`, {
      decode: (v) => check(PartyMsg, v),
      queue: 4,
      onMessage: (m) => { if (m.t === "members") onMembers(m.members); else if (m.t === "start") onStart(m); else onRefused(m.why); },
      onClose: (e) => { if (e.code === 4000) { onGone("This party is open in another tab."); return; } if (!e.seen) onGone("No such party."); return e.seen && e.tries < 4 ? 1000 * e.tries : null; },
    });
  }

  return {
    make, join,
    ready: (r: boolean) => void link?.send({ t: "ready", ready: r }),
    start: () => void link?.send({ t: "start" }),
    leave: () => { link?.close(); link = null; },
    onStart: (f: typeof onStart) => { onStart = f; },
    onMembers: (f: typeof onMembers) => { onMembers = f; },
    onRefused: (f: typeof onRefused) => { onRefused = f; },
    onGone: (f: typeof onGone) => { onGone = f; },
  };
}
