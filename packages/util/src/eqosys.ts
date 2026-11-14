// Signing in through eqosys, from a page: send the player to eqosys's /login with a PKCE challenge, and
// when they come back with ?code=&state=, trade it for who they are and a token. The login is kept in
// localStorage; the token is what the app's Worker checks (`TokenChecker` from ./token). It lasts ten minutes,
// so the page renews it in the background with a one-use refresh token kept beside it. When that fails (a month
// unused, or a sign-out on eqosys), the next load checks with eqosys quietly (`prompt=none`): still signed in
// there, the player comes straight back signed in with no page shown; signed out, they stay a guest.
// `signInHere` signs in through a small window beside the page, so a game that is running keeps running.
// Worked example: apps/park-hide-seek/src/ui/eqosys.ts.
import { b64url, digest } from "./bytes.ts";
import { arr, bool, check, int, nul, num, obj, oneOf, opt, str, type Guard, type Of } from "./guard.ts";
import { getJson } from "./http.ts";
import { connectSocket, type Link } from "./socket.ts";
import { mountReportButton, sendReport, type ReportIn, type Sent } from "./report.ts";
import { eqBadge, eqButton, wearSkin, ICONS, type Skin } from "./skin.ts";
import { peek } from "./token.ts";
import { PartyRules } from "./party-rules.ts";

export type { Skin } from "./skin.ts";

/** What the page keeps of a sign-in. */
export const Login = obj({ name: str(200), email: str(320), token: str(8192), refresh: opt(str(100)) });
export type Login = Of<typeof Login>;

/** POST eqosys /api/exchange: who signed in, and the token the Worker checks. `token` is null while eqosys has no signing key. */
export const ExchangeReply = obj({
  user: obj({ id: str(200), email: str(320), name: str(200) }),
  app: str(64), source: str(64), access: arr(str(32), 100), token: nul(str(8192)), refresh: opt(str(100)),
});
/** POST eqosys /oauth/token with a refresh token: the next token and the next refresh token (the one sent is spent). */
const Renewed = obj({ access_token: str(8192), refresh_token: str(100) });
export type ExchangeReply = Of<typeof ExchangeReply>;

export interface Returned { login: Login | null; then: string; error?: string }
/** What the sign-in window tells the page that opened it: the code eqosys sent it back with. The verifier never leaves the page. */
const Handed = obj({ code: str(100), state: str(200) });
/** A sign-in that began in `signInHere`'s window carries this at the front of its state. */
const WINDOW = "w.";

/** One achievement as eqosys shows it to the player (a secret one is "Secret achievement" until `at` is set). */
export const Achievement = obj({ id: str(64), name: str(200), blurb: str(400), secret: bool(false), at: nul(int(0, 1e15)) });
export type Achievement = Of<typeof Achievement>;
/** POST /q/achieve: the achievement, and whether this was the first time (show the toast) or not. */
export const Unlock = obj({ achievement: Achievement, new: bool() });
export type Unlock = Of<typeof Unlock>;

export interface EqosysConfig {
  /** This app's id in eqosys's APPS. */
  app: string;
  /** Where eqosys lives. */
  url: string;
  /** The origins eqosys sends players back to. Any other page (a desktop app, a LAN host) keeps the typed name. */
  from: readonly string[];
  /** Prefix for what is kept in localStorage (`<prefix>.login`, `<prefix>.eqosys`) and sessionStorage. */
  prefix: string;
  /**
   * This game's look for every surface the client mounts (account chip, achievement toast, report button and form, party
   * lobby, spaces panel): `--ui-*` tokens and any extra rules on the `eq-*` classes (./skin.ts). Left out, the house look.
   */
  skin?: Skin;
}

/** The sign-in client for one app. `signIn`, `signInHere`, `finishSignIn`, `login`, `fresh`, `signOut`, `eqosysUrl`, `canSignIn`, `accountChip`, and `achieve` / `achievements`. */
export function eqosys({ app, url, from, prefix, skin }: EqosysConfig) {
  if (skin) wearSkin(skin);
  const kept = {
    get(k: string) { try { return localStorage.getItem(`${prefix}.${k}`) ?? ""; } catch { return ""; } },
    put(k: string, v: string) { try { v ? localStorage.setItem(`${prefix}.${k}`, v) : localStorage.removeItem(`${prefix}.${k}`); } catch {} },
  };
  /** The handoff's secrets live only in this tab, and only until the player is back. */
  const once = {
    take(k: string) { try { const v = sessionStorage.getItem(`${prefix}.eq.${k}`) ?? ""; sessionStorage.removeItem(`${prefix}.eq.${k}`); return v; } catch { return ""; } },
    put(k: string, v: string) { try { sessionStorage.setItem(`${prefix}.eq.${k}`, v); } catch {} },
  };
  const keep = (l: Login | null) => { kept.put("login", l ? JSON.stringify(l) : ""); if (l) plan(); };

  /** Where eqosys is for this page: the live one, or the `<prefix>.eqosys` setting (a local eqosys, `bun run dev` there with loopback returns on). */
  const eqosysUrl = () => (kept.get("eqosys") || url).replace(/\/$/, "");
  /** Whether eqosys would send a player back here: the online game, or a local eqosys for a page on this machine. */
  const canSignIn = () => from.includes(location.origin) || !!kept.get("eqosys");
  /** The page without the handoff's query, where eqosys sends the player back. It must be one of the app's `returns` in eqosys's
   * APPS (each origin's root unless it says otherwise), so sign in from that page. */
  const here = () => `${location.origin}${location.pathname}`;

  /** Off to eqosys. `then` is what the player was doing ("play"), picked up again when they come back. */
  async function signIn(then = "", quiet = false): Promise<void> {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    once.put("verifier", verifier); once.put("state", state); once.put("then", then);
    // A quiet check leaves on its own, so the page's query (an invite's room code) comes back with it.
    if (quiet) once.put("quiet", `${location.search}${location.hash}` || "?");
    const q = new URLSearchParams({ app, return: here(), challenge: b64url(await digest(verifier)), state, ...(quiet ? { prompt: "none" } : {}) });
    location.assign(`${eqosysUrl()}/login?${q}`);
  }

  /** Trade eqosys's code for the login, and keep it. */
  async function trade(code: string, verifier: string, then: string): Promise<Returned> {
    const got = await getJson(`${eqosysUrl()}/api/exchange`, ExchangeReply, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app, code, verifier, keep: true }) });
    if (!got) return { login: null, then, error: "eqosys didn't let that sign-in through. Try again." };
    if (!got.token) return { login: null, then, error: "eqosys isn't handing out tokens yet, so you can't sign in here. Play with a name for now." };
    waiting.clear();
    const login: Login = { name: got.user.name, email: got.user.email, token: got.token, ...(got.refresh ? { refresh: got.refresh } : {}) };
    keep(login);
    void sendHeld().then((news) => { for (const u of news) celebrate(u.achievement); });
    return { login, then };
  }

  /**
   * Sign in without leaving the page: eqosys opens in a small window, and this answers once the player is back (the
   * login, or null with no error when they closed the window). Call it straight from the click, or the browser blocks
   * the window; where it is blocked anyway (some in-app browsers), the whole page goes to eqosys as `signIn` does.
   */
  function signInHere(then = ""): Promise<Returned> {
    const win = typeof window === "undefined" ? null : window.open("", "eq-signin", "popup,width=480,height=720");
    if (!win) { void signIn(then); return new Promise(() => {}); }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const state = WINDOW + b64url(crypto.getRandomValues(new Uint8Array(12)));
    const news = new BroadcastChannel(`${prefix}.eq.signin`);
    return new Promise((done) => {
      let over = false, trading = false;
      const end = (r: Returned) => { if (over) return; over = true; clearInterval(watch); news.close(); done(r); };
      // The window closed with no code (a moment's grace: the code is sent just before it closes): they changed their mind.
      // A page that is cross-origin isolated can't see its window close: there, only the code ends the wait.
      const watch = setInterval(() => { if (win.closed && !globalThis.crossOriginIsolated) setTimeout(() => { if (!trading) end({ login: null, then }); }, 600); }, 400);
      news.onmessage = (e) => {
        const m = check(Handed, e.data);
        if (m && m.state === state && !trading) { trading = true; void trade(m.code, verifier, then).then(end); }
      };
      void digest(verifier).then((d) => { win.location.href = `${eqosysUrl()}/login?${new URLSearchParams({ app, return: here(), challenge: b64url(d), state })}`; });
    });
  }

  /**
   * Back from eqosys with ?code=&state=: trade the code in and keep the login. Answers what to carry on with, or
   * null when this wasn't a return. The query is taken off the address either way, so a reload doesn't retry it.
   */
  async function finishSignIn(): Promise<Returned | null> {
    const q = new URLSearchParams(location.search);
    const code = q.get("code"), state = q.get("state"), refused = q.get("error") === "login_required";
    if ((code === null && !refused) || state === null) return stale();
    const quiet = once.take("quiet");
    q.delete("code"); q.delete("state"); if (refused) q.delete("error");
    const rest = quiet && quiet !== "?" ? quiet : `${q.size ? "?" + q : ""}${location.hash}`;
    history.replaceState(null, "", `${location.pathname}${rest}`);
    // This is `signInHere`'s window: hand the code to the page that opened it and go. That page holds the verifier, so the
    // code is no use to anyone else listening. A window that can't close itself becomes the game, signed in by then.
    if (code !== null && state.startsWith(WINDOW)) {
      const news = new BroadcastChannel(`${prefix}.eq.signin`);
      news.postMessage({ code, state } satisfies Of<typeof Handed>);
      setTimeout(() => window.close(), 200);
      setTimeout(() => location.assign(`${location.pathname}${rest}`), 2000);
      return new Promise(() => {});
    }
    const verifier = once.take("verifier"), then = once.take("then");
    if (!verifier || state !== once.take("state")) return { login: null, then, error: "That sign-in didn't start here. Try again." };
    // The quiet check found nobody signed in on eqosys: a guest, and the run-out login is let go so the page doesn't ask again.
    if (refused || code === null) { keep(null); return null; }
    return trade(code, verifier, then);
  }

  /** The login kept from the last sign-in, if any. Its token may have run out: see `fresh`. */
  function login(): Login | null {
    try { return check(Login, JSON.parse(kept.get("login") || "null")); } catch { return null; }
  }

  /** Whether the token still has `forMs` to run: long enough for the server to check it when the request lands. */
  const fresh = (l: Login, forMs = 30_000, now = Date.now()) => (peek(l.token)?.exp ?? 0) * 1000 > now + forMs;

  function signOut() {
    const spent = login()?.refresh;
    keep(null);
    if (spent) void fetch(`${eqosysUrl()}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: spent }), keepalive: true }).catch(() => {});
  }

  /** The kept login's token, renewed with its refresh token: "ok" (fresh now, maybe by another tab), "refused" (eqosys said no: spent,
   * a month old, or a sign-out there), or "down" (eqosys couldn't be reached). One renewal at a time. */
  let renewing: Promise<"ok" | "refused" | "down"> | null = null;
  function renew(): Promise<"ok" | "refused" | "down"> {
    return renewing ??= (async () => {
      const l = login();
      if (l && fresh(l, 60_000)) return "ok" as const;
      if (!l?.refresh) return "refused" as const;
      const res = await fetch(`${eqosysUrl()}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: app, refresh_token: l.refresh }) }).catch(() => null);
      if (!res || res.status >= 500) return "down" as const;
      const got = res.ok ? check(Renewed, await res.json().catch(() => null)) : null;
      if (got) { keep({ ...l, token: got.access_token, refresh: got.refresh_token }); return "ok" as const; }
      // Another tab may have spent it first and kept the next one.
      const now = login();
      if (now && fresh(now, 60_000)) return "ok" as const;
      if (now?.refresh === l.refresh) keep({ name: l.name, email: l.email, token: l.token });
      return "refused" as const;
    })().finally(() => { renewing = null; });
  }

  /** Renew a minute before the token runs out, and on coming back to a tab whose timer the browser held back. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  function plan() {
    clearTimeout(timer);
    const l = login(), exp = l?.refresh ? (peek(l.token)?.exp ?? 0) * 1000 : 0;
    if (!exp) return;
    timer = setTimeout(() => void renew(), Math.max(0, exp - Date.now() - 60_000));
    (timer as { unref?: () => void }).unref?.();
  }
  if (typeof document !== "undefined") document.addEventListener?.("visibilitychange", () => { if (document.visibilityState === "visible" && login()?.refresh) void renew(); });
  plan();

  /** Not a return from eqosys: a run-out login is renewed, or else checked quietly with eqosys once per tab (the page leaves for it). */
  async function stale(): Promise<null> {
    const l = login();
    if (!l || fresh(l)) return null;
    const r = await renew();
    if (r === "ok" || r === "down" || !canSignIn()) return null;
    // A login from before refresh tokens never asked eqosys: only leave for it when it answers, so a player never lands on its error page.
    if (!l.refresh && !await fetch(`${eqosysUrl()}/health`, { mode: "no-cors" }).then(() => true, () => false)) return null;
    try { if (sessionStorage.getItem(`${prefix}.eq.tried`)) return null; sessionStorage.setItem(`${prefix}.eq.tried`, "1"); } catch { return null; }
    await signIn("", true);
    return new Promise<null>(() => {}); // the page is on its way to eqosys and back
  }

  /** Who this page joins a game's room as (`whoIs` / `seatDoor` read it): the eqosys token while it lasts, else `guest` (`guestId`). */
  const who = (guest: string): { token: string } | { uid: string } => { const l = login(); return l && fresh(l) ? { token: l.token } : { uid: guest }; };

  /** Send a bug report, suggestion or error to the RustyBuns repo through eqosys (needs a fresh login). */
  const report = async (r: ReportIn): Promise<Sent> => {
    const l = login();
    return l && fresh(l, 5_000) ? sendReport(eqosysUrl(), l.token, r) : { ok: false, error: "Sign in with eqosys first." };
  };
  /** A corner "Report" button for the page, only where eqosys can send the player back. Signed out, it sends them through eqosys. */
  const reportButton = (build?: string) => !canSignIn() ? () => {} : mountReportButton({ token: () => { const l = login(); return l && fresh(l, 5_000) ? l.token : null; }, url: eqosysUrl, signIn: () => void signIn("report"), build });

  /** Achievements earned while signed out or offline, kept until they can be sent. */
  const held = () => { try { const v: unknown = JSON.parse(kept.get("held") || "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []; } catch { return []; } };
  const hold = (ids: string[]) => kept.put("held", ids.length ? JSON.stringify([...new Set(ids)]) : "");
  const freshToken = () => { const l = login(); return l && fresh(l, 5_000) ? l.token : null; };

  /** What this page has already tried to unlock, so calling `achieve` from a per-frame or per-render spot costs nothing after the first. */
  const tried = new Map<string, Unlock>(), waiting = new Set<string>();

  /** Send one achievement: the reply, "drop" for one eqosys won't take (not in this app's catalog, or an alpha badge once it is out of alpha), or null to try again later. */
  async function send(id: string, token: string): Promise<Unlock | "drop" | null> {
    const res = await fetch(`${eqosysUrl()}/q/achieve`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (res?.status === 404 || res?.status === 400 || res?.status === 409) return "drop";
    if (!res?.ok) return null;
    try { return check(Unlock, await res.json()); } catch { return null; }
  }

  /** Send what was earned while signed out. Answers the ones that were new, for the game to show. */
  async function sendHeld(): Promise<Unlock[]> {
    const token = freshToken(), waiting = held();
    if (!token || !waiting.length) return [];
    const out: Unlock[] = [], still: string[] = [];
    for (const id of waiting) {
      const r = await send(id, token);
      if (r === null) still.push(id); else if (r !== "drop" && r.new) out.push(r);
    }
    hold([...still, ...held().filter((id) => !waiting.includes(id))]);
    return out;
  }

  /**
   * Unlock achievement `id` (one in this app's catalog in eqosys's achievements.ts). Answers the unlock, `new` true the
   * first time; signed out or offline it is kept and sent on the next sign-in, and this answers null. Safe to call every time it happens: a page asks eqosys once per id.
   */
  async function achieve(id: string): Promise<Unlock | null> {
    const had = tried.get(id);
    if (had) return { ...had, new: false };
    const token = freshToken();
    if (!token) { if (!waiting.has(id)) { waiting.add(id); hold([...held(), id]); } return null; }
    const r = await send(id, token);
    if (r === null) hold([...held(), id]);
    if (r === null || r === "drop") return null;
    tried.set(id, r);
    if (r.new) celebrate(r.achievement);
    return r;
  }

  /** This app's whole catalog for the player, earned ones first; null when signed out or eqosys can't be reached. */
  async function achievements(): Promise<Achievement[] | null> {
    const token = freshToken();
    if (!token) return null;
    return (await getJson(`${eqosysUrl()}/q/achieve`, obj({ achievements: arr(Achievement, 500) }), { headers: { authorization: `Bearer ${token}` } }))?.achievements ?? null;
  }

  /** A Qollab party client for this app, signed with the kept login. See `party`. */
  const token = () => { const l = login(); return l && fresh(l, 5_000) ? l.token : null; };
  const partyClient = () => party({ url: eqosysUrl, token });
  const spaceClient = () => space({ url: eqosysUrl, token });
  const hubClient = () => hub({ url: eqosysUrl, token });

  /**
   * The account chip, in `slot`: the eqosys name and a way out, a way in where eqosys can send the player back, or nothing.
   * `note` is what went wrong coming back from eqosys; `onSignOut` runs after signing out (a page that must reload, say).
   */
  function accountChip(slot: HTMLElement, o: { note?: string; onSignOut?: () => void; /** Given, "Sign in" opens eqosys beside the page (`signInHere`) and this hears the login; the page never reloads. */ onSignIn?: (login: Login) => void } = {}): HTMLElement {
    wearSkin();
    const who = login();
    slot.classList.add("eq", "eq-chip");
    slot.classList.toggle("in", !!who);
    slot.replaceChildren();
    if (who) slot.append(Object.assign(document.createElement("span"), { className: "eq-who", textContent: who.name, title: who.email }), eqButton({ text: "Sign out", icon: "log-out", onClick: () => { signOut(); accountChip(slot, { onSignOut: o.onSignOut, onSignIn: o.onSignIn }); o.onSignOut?.(); } }));
    else if (canSignIn()) slot.append(eqButton({ text: "Sign in", icon: "log-in", show: true, onClick: () => {
      const hear = o.onSignIn;
      if (!hear) return void signIn();
      void signInHere().then((r) => { accountChip(slot, { ...o, note: r.error }); if (r.login) hear(r.login); });
    } }));
    if (o.note) slot.append(Object.assign(document.createElement("small"), { className: "eq-note", textContent: o.note }));
    return slot;
  }

  return { signIn, signInHere, finishSignIn, login, fresh, signOut, who, eqosysUrl, canSignIn, accountChip, report, reportButton, party: partyClient, space: spaceClient, hub: hubClient, achieve, achievements, sendHeld, celebrate };
}

/**
 * A guest's secret id for a game's rooms, kept under `key`: in localStorage, so the browser comes back as the same
 * player, or with `tab` in sessionStorage, so a reload rejoins but two tabs are two players (handy for trying it alone).
 * The room only shows others `publicId` of it.
 */
export function guestId(key: string, o: { tab?: boolean } = {}): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const store = o.tab ? sessionStorage : localStorage;
    const kept = store.getItem(key);
    if (kept) return kept;
    const made = make();
    store.setItem(key, made);
    return made;
  } catch { return make(); }
}

/** The achievement toast, at the top of the page in its eqosys skin: `achieve` shows it for each first unlock. Gone after `ms`. */
export function celebrate(a: Achievement, ms = 4200): HTMLElement | null {
  if (typeof document === "undefined") return null;
  wearSkin();
  let host = document.querySelector<HTMLElement>(".eq-toasts");
  if (!host) { host = Object.assign(document.createElement("div"), { className: "eq eq-toasts" }); host.setAttribute("aria-live", "polite"); document.body.append(host); }
  const t = Object.assign(document.createElement("div"), { className: "eq-toast", role: "status" });
  t.innerHTML = ICONS.trophy;
  const words = document.createElement("div");
  words.append(...([["small", "Achievement unlocked"], ["b", a.name], ["span", a.blurb]] as const).map(([tag, text]) => Object.assign(document.createElement(tag), { textContent: text })));
  t.append(words, eqBadge());
  host.append(t);
  if (ms > 0) setTimeout(() => t.remove(), ms);
  return t;
}

/**
 * The subprotocol an eqosys socket (hub, party, space) is opened with, the token offered second: a header, not `?token=`,
 * because a URL lands in access logs.
 */
export const SOCKET_PROTOCOL = "eqosys";

/** A member of a party as eqosys's party shows them. */
export const PartyMember = obj({ id: str(200), name: str(200), ready: bool(false), host: bool(false) });
export type PartyMember = Of<typeof PartyMember>;
/** What a party says: who is in, that the host started (go to `room`, sit in `seat`), or why a request was refused. */
export const PartyMsg: Guard<
  { t: "members"; members: PartyMember[] } | { t: "start"; room: string; seat: number; ticket?: string } | { t: "refused"; why: string }
  | { t: "say"; from: { id: string; name: string }; text: string; at: number } | { t: "reported"; by: string; id: string; name: string }
  | { t: "rules"; rules: PartyRules; blocked?: { id: string; name: string }[]; invite?: string }
> = (v) => {
  const t = check(obj({ t: oneOf(["members", "start", "refused", "say", "reported", "rules"]) }), v)?.t;
  if (t === "rules") { const r = obj({ rules: PartyRules, blocked: opt(arr(obj({ id: str(200), name: str(200) }), 1000)), invite: opt(str(64)) })(v); return { t, rules: r.rules, ...(r.blocked && { blocked: r.blocked }), ...(r.invite && { invite: r.invite }) }; }
  if (t === "members") return { t, members: obj({ members: arr(PartyMember, 1000) })(v).members };
  if (t === "start") { const st = obj({ room: str(64), seat: int(0, 1000), ticket: opt(str(4096)) })(v); return { t, room: st.room, seat: st.seat, ...(st.ticket && { ticket: st.ticket }) }; }
  if (t === "refused") return { t, why: obj({ why: str(500) })(v).why };
  if (t === "say") return { t, ...obj({ from: obj({ id: str(200), name: str(200) }), text: str(280), at: int(0, 1e15) })(v) };
  if (t === "reported") return { t, ...obj({ by: str(200), id: str(200), name: str(200) })(v) };
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
 * `start()`. Everyone hears `onStart({ room, seat, ticket })` (the ticket: eqosys's word on both, for the game's Worker) and carries on in their own world. `onMembers` hears who is in and who is ready.
 * eqosys seats a player once per party, so a page keeps one client per party: each `on...` adds a listener, and
 * joining the code already joined is the same socket, so a lobby and another panel on one page can share it.
 */
export function party({ url, token }: PartyConfig) {
  type Out = { t: string; ready?: boolean; text?: string; id?: string; on?: boolean; rules?: PartyRules };
  let link: Link<Out> | null = null, joined = "", lastWhy = "";
  const onRules = ears<Extract<PartyMsg, { t: "rules" }>>();
  /** Who this player muted for themselves: kept in this browser, never told to the party. Their lines don't reach `onSay`. */
  const HIDDEN = "eq.party.hidden";
  const hidden = (): Set<string> => { try { const v: unknown = JSON.parse(localStorage.getItem(HIDDEN) ?? "[]"); return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []); } catch { return new Set(); } };
  const hide = (id: string, on = true) => { const h = hidden(); if (on) h.add(id); else h.delete(id); try { localStorage.setItem(HIDDEN, JSON.stringify([...h])); } catch { /* private window: for this page only */ } };
  const onStart = ears<{ room: string; seat: number; ticket?: string }>(), onMembers = ears<PartyMember[]>(), onRefused = ears<string>(), onGone = ears<string>();
  const onSay = ears<Extract<PartyMsg, { t: "say" }>>(), onReported = ears<Extract<PartyMsg, { t: "reported" }>>();

  /** A new party's code, or null when signed out or eqosys refused (too many parties just now, say). */
  async function make(open = false): Promise<string | null> {
    const t = token();
    if (!t) return null;
    const got = await getJson(`${url()}/q/party${open ? "?open=1" : ""}`, obj({ code: str(12) }), { method: "POST", headers: { authorization: `Bearer ${t}` } });
    return got?.code ?? null;
  }

  /** Who was in at the last word from the party, for a listener that joins after it. */
  let members: PartyMember[] | null = null;
  /** Open the party's socket, with the invite key the party link carried (the door wants it when only the host invites).
   *  `onGone` hears "no such party" or any close that isn't a retry. Joined already: who is in, again. */
  function join(code: string, invite?: string) {
    if (link && joined === code) { if (members) onMembers.hear(members); return; }
    const t = token();
    if (!t) { onGone.hear("Sign in with eqosys first."); return; }
    link?.close();
    joined = code; members = null; lastWhy = "";
    link = connectSocket<PartyMsg, Out>(() => `${url().replace(/^http/, "ws")}/q/party/${encodeURIComponent(code)}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`, {
      protocols: [SOCKET_PROTOCOL, t],
      decode: (v) => check(PartyMsg, v),
      queue: 4,
      onMessage: (m) => { if (m.t === "members") onMembers.hear(members = m.members); else if (m.t === "start") onStart.hear(m); else if (m.t === "say") { if (!hidden().has(m.from.id)) onSay.hear(m); } else if (m.t === "reported") onReported.hear(m); else if (m.t === "rules") onRules.hear(m); else onRefused.hear(lastWhy = m.why); },
      onClose: (e) => {
        if (e.code === 4000) { onGone.hear("This party is open in another tab."); return; }
        // The door's refusals (party.ts): its own words came just before the close; stop trying.
        if (e.code === 4403) { onGone.hear(lastWhy || "Only the host's friends can join with the code alone: ask someone in the party for its link."); return; }
        if (e.code === 4405 || e.code === 4407 || e.code === 4408 || e.code === 4410) { onGone.hear(lastWhy || "The party didn't let you in."); return; }
        if (e.code === 4406) { onGone.hear("The host took you out of the party."); return; }
        if (e.code === 4409) { onGone.hear("The host ended the party."); return; }
        if (!e.seen) onGone.hear("No such party.");
        return e.seen && e.tries < 4 ? 1000 * e.tries : null;
      },
    });
  }

  return {
    make, join,
    ready: (r: boolean) => void link?.send({ t: "ready", ready: r }),
    start: () => void link?.send({ t: "start" }),
    say: (text: string) => void link?.send({ t: "say", text }),
    /** Quiet a member for the whole party (or `false` to let them speak again): the host's, or whoever the `mute` rule says. */
    mute: (id: string, on = true) => void link?.send({ t: "mute", id, on }),
    report: (id: string) => void link?.send({ t: "report", id }),
    /** Host only: the party's rules (@rustybuns/util/party-rules), all at once. */
    rules: (rules: PartyRules) => void link?.send({ t: "rules", rules }),
    /** Host only: take a member out (they may come back), block or unblock someone (refused at the door), or hand them the party. */
    kick: (id: string) => void link?.send({ t: "kick", id }),
    block: (id: string, on = true) => void link?.send({ t: "block", id, on }),
    makeHost: (id: string) => void link?.send({ t: "host", id }),
    /** Host only: a fresh invite key, so every party link handed out so far stops letting people in. */
    relink: () => void link?.send({ t: "relink" }),
    /** Mute someone for yourself only: their chat lines stop reaching this page. Kept in this browser. */
    hide, hidden,
    onRules: onRules.add,
    onSay: onSay.add,
    onReported: onReported.add,
    leave: () => { link?.close(); link = null; joined = ""; members = null; },
    onStart: onStart.add,
    onMembers: onMembers.add,
    onRefused: onRefused.add,
    onGone: onGone.add,
  };
}
/** Listeners for one kind of party message: `add` one, `hear` tells them all. */
function ears<T>() {
  const fs: ((v: T) => void)[] = [];
  return { add: (f: (v: T) => void) => { fs.push(f); }, hear: (v: T) => { for (const f of fs) f(v); } };
}

/** A friend as a person's hub (apps/eqosys/src/hub.ts) shows them to an app: who, and which apps they have open. */
export const HubFriend = obj({ id: str(200), name: str(200, { min: 0 }), presence: arr(obj({ app: str(64), doing: str(80, { min: 0 }) }), 50) });
export type HubFriend = Of<typeof HubFriend>;
/** A note in the hub: a friend's ask or answer, or what an app told you for them (`app`, with its text and link). */
export const HubNote = obj({ key: str(64), at: num(0, 1e14), kind: str(16), from: obj({ id: str(200), name: str(200, { min: 0 }) }), app: opt(str(64)), text: opt(str(280)), link: opt(str(2000)) });
export type HubNote = Of<typeof HubNote>;
/** What an app reads of the hub: friends, notes, and the person's friend link (asks are eqosys's own page's business). */
export const HubView = obj({ friends: arr(HubFriend, 1000), notes: arr(HubNote, 1000), link: opt(str(300)) });
export type HubView = Of<typeof HubView>;

/**
 * The page's side of a person's Qollab hub, one op at a time (POST /api/hub with the app's token): `state()` for their
 * friends and notes, `notify(id, text, link)` to tell one friend something from this app (a link on the app's own
 * site, an invite say), which lands in that friend's notes. Friends are made on eqosys's own page (`friendsPage`).
 */
export function hub({ url, token }: PartyConfig) {
  async function op(body: Record<string, string>): Promise<{ ok: true; view: HubView | null } | { ok: false; error: string }> {
    const t = token();
    if (!t) return { ok: false, error: "Sign in with eqosys first." };
    const res = await fetch(`${url()}/api/hub`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, error: "eqosys can't be reached." };
    const v: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: check(obj({ error: str(500) }), v)?.error ?? "eqosys said no." };
    return { ok: true, view: check(HubView, v) };
  }
  return {
    /** Friends and notes, or null when signed out or eqosys can't be reached. */
    state: async (): Promise<HubView | null> => { const r = await op({ op: "state" }); return r.ok ? r.view : null; },
    /** Tell friend `id`: null when sent, else why not. */
    notify: async (id: string, text: string, link?: string): Promise<string | null> => { const r = await op({ op: "notify", id, text, ...(link ? { link } : {}) }); return r.ok ? null : r.error; },
    /** The person's friend link, to copy or share: whoever opens it and signs in (or makes an account) is their friend. Null signed out. */
    friendLink: async (): Promise<string | null> => { const r = await op({ op: "state" }); return r.ok && r.view?.link ? `${url()}/add/${r.view.link}` : null; },
    /** Where on eqosys a person adds friends. */
    friendsPage: () => `${url()}/?tab=friends`,
  };
}

/** A message in a space's channel: its number there, and who said what when. */
export const SpaceMessage = obj({ id: int(1, 1e12), from: obj({ id: str(200), name: str(200) }), text: str(280), at: int(0, 1e15) });
export type SpaceMessage = Of<typeof SpaceMessage>;
/** A voice channel: its id (what `talk` and `inVoice` take) and its name. */
export const SpaceVoice = obj({ id: str(24), name: str(24) });
export type SpaceVoice = Of<typeof SpaceVoice>;
/** Someone online in a space, and the voice channel their page is in. */
export const SpaceMember = obj({ id: str(200), name: str(200), voice: opt(str(24)) });
export type SpaceMember = Of<typeof SpaceMember>;
/**
 * What a space says: its name and channels, who is online, a new message, a page of history, a refusal, (to the owner)
 * a report, or (to whoever asked) a one-use ticket into a voice channel on Qlave, for `join` in @rustybuns/util/voice.
 */
export const SpaceMsg: Guard<
  | { t: "space"; name: string; channels: string[]; voice: SpaceVoice[]; owner: boolean }
  | { t: "online"; members: SpaceMember[] }
  | ({ t: "said"; channel: string } & SpaceMessage)
  | { t: "history"; channel: string; messages: SpaceMessage[]; more: boolean }
  | { t: "refused"; why: string }
  | { t: "reported"; by: string; id: string; name: string }
  | { t: "ticket"; channel: string; url: string; ticket: string }
> = (v) => {
  const t = check(obj({ t: oneOf(["space", "online", "said", "history", "refused", "reported", "ticket"]) }), v)?.t;
  const ch = str(24);
  if (t === "space") return { t, ...obj({ name: str(60), channels: arr(ch, 100), voice: arr(SpaceVoice, 100), owner: bool() })(v) };
  if (t === "online") return { t, ...obj({ members: arr(SpaceMember, 1000) })(v) };
  if (t === "ticket") return { t, ...obj({ channel: ch, url: str(300, { re: /^https?:\/\// }), ticket: str(5000) })(v) };
  if (t === "said") return { t, channel: obj({ channel: ch })(v).channel, ...SpaceMessage(v) };
  if (t === "history") return { t, ...obj({ channel: ch, messages: arr(SpaceMessage, 100), more: bool() })(v) };
  if (t === "refused") return { t, why: obj({ why: str(500) })(v).why };
  if (t === "reported") return { t, ...obj({ by: str(200), id: str(200), name: str(200) })(v) };
  throw new Error("not a space message");
};
export type SpaceMsg = Of<typeof SpaceMsg>;
/** A space a person is in, as GET /q/space lists it; `invite` only on the ones they own. */
export const SpaceRow = obj({ id: str(64), name: str(60), owner: bool(), invite: opt(str(12)) });
export type SpaceRow = Of<typeof SpaceRow>;
export const SpaceRows = obj({ spaces: arr(SpaceRow, 1000) });

/** What a page hears from an open space. Every one is optional. */
export interface SpaceHandlers {
  space?: (s: { name: string; channels: string[]; voice: SpaceVoice[]; owner: boolean }) => void;
  online?: (members: SpaceMember[]) => void;
  said?: (channel: string, m: SpaceMessage) => void;
  history?: (channel: string, messages: SpaceMessage[], more: boolean) => void;
  refused?: (why: string) => void;
  reported?: (r: { by: string; id: string; name: string }) => void;
  /** The ticket `talk` asked for: hand `url` and `ticket` to `join` in @rustybuns/util/voice. */
  ticket?: (channel: string, url: string, ticket: string) => void;
  /** The socket is gone for good: removed, the space deleted, or it never opened. */
  gone?: (why: string) => void;
}

/**
 * The page's side of Qollab's spaces (apps/eqosys, QOLLAB.md): groups that last, across every Q app, with text channels.
 * `mine()` lists them, `make(name)` and `join(invite)` add one, `open(id, on)` connects; then `say`, `history`, and for the
 * owner `channel`, `mute` and `kick`. `leave()` takes you out of the space; `close()` only hangs up.
 */
export function space({ url, token }: PartyConfig) {
  type Out = { t: string; channel?: string; text?: string; before?: number; id?: string; on?: boolean; voice?: boolean };
  let link: Link<Out> | null = null;
  const authed = (method: string, body?: unknown): RequestInit | null => {
    const t = token();
    return t ? { method, headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) } : null;
  };
  const send = (m: Out) => void link?.send(m);

  return {
    /** The spaces this person is in, or null when signed out or eqosys didn't answer. */
    async mine(): Promise<SpaceRow[] | null> {
      const init = authed("GET");
      return init ? (await getJson(`${url()}/q/space`, SpaceRows, init))?.spaces ?? null : null;
    },
    /** A new space, owned by this person: its id and the invite code to hand out. */
    async make(name: string) {
      const init = authed("POST", { name });
      return init ? getJson(`${url()}/q/space`, obj({ id: str(64), invite: str(12) }), init) : null;
    },
    /** Join by an invite code: the space's id and name, or null for a wrong code. */
    async join(invite: string) {
      const init = authed("POST", { invite });
      return init ? getJson(`${url()}/q/space/join`, obj({ id: str(64), name: str(60) }), init) : null;
    },
    open(id: string, on: SpaceHandlers) {
      const t = token();
      if (!t) { on.gone?.("Sign in with eqosys first."); return; }
      link?.close();
      link = connectSocket<SpaceMsg, Out>(() => `${url().replace(/^http/, "ws")}/q/space/${encodeURIComponent(id)}`, {
        protocols: [SOCKET_PROTOCOL, t],
        decode: (v) => check(SpaceMsg, v),
        queue: 8,
        onMessage: (m) => {
          if (m.t === "space") on.space?.(m);
          else if (m.t === "online") on.online?.(m.members);
          else if (m.t === "said") { const { t: _, channel, ...msg } = m; on.said?.(channel, msg); }
          else if (m.t === "history") on.history?.(m.channel, m.messages, m.more);
          else if (m.t === "reported") on.reported?.(m);
          else if (m.t === "ticket") on.ticket?.(m.channel, m.url, m.ticket);
          else on.refused?.(m.why);
        },
        onClose: (e) => {
          if (e.code >= 4000) { on.gone?.(e.reason || "Closed."); return null; }
          if (!e.seen) { on.gone?.("Not a space you're in."); return null; }
          return e.tries < 4 ? 1000 * e.tries : null;
        },
      });
    },
    say: (channel: string, text: string) => send({ t: "say", channel, text }),
    /** The newest page of a channel, or the page before message number `before`. */
    history: (channel: string, before?: number) => send({ t: "history", channel, ...(before ? { before } : {}) }),
    /** Owner only: add a channel (lower-case letters, digits and dashes), a voice one with `voice`. */
    channel: (name: string, voice = false) => send({ t: "channel", channel: name, ...(voice ? { voice } : {}) }),
    /** Owner only: delete a channel (a voice one by its id). #general stays. */
    drop: (channel: string) => send({ t: "drop", channel }),
    /** Ask for a ticket into a voice channel; it comes back to `ticket`. */
    talk: (channel: string) => send({ t: "talk", channel }),
    /** Tell the space this page joined a voice channel on Qlave, or left (no channel). */
    inVoice: (channel?: string) => send({ t: "voice", ...(channel ? { channel } : {}) }),
    mute: (id: string, on = true) => send({ t: "mute", id, on }),
    kick: (id: string) => send({ t: "kick", id }),
    report: (id: string) => send({ t: "report", id }),
    leave: () => { send({ t: "leave" }); },
    close: () => { link?.close(); link = null; },
  };
}
