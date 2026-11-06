// Signing in through eqosys, from a page: send the player to eqosys's /login with a PKCE challenge, and
// when they come back with ?code=&state=, trade it for who they are and a token. The login is kept in
// localStorage; the token is what the app's Worker checks (`TokenChecker` from ./token), so once it has
// run out the player goes through eqosys again, which is one click when they are still signed in there.
// Worked example: apps/park-hide-seek/src/ui/eqosys.ts.
import { b64url, digest } from "./bytes.ts";
import { arr, bool, check, int, nul, obj, oneOf, opt, str, type Guard, type Of } from "./guard.ts";
import { getJson } from "./http.ts";
import { connectSocket, type Link } from "./socket.ts";
import { mountReportButton, sendReport, type ReportIn, type Sent } from "./report.ts";
import { eqBadge, eqButton, wearSkin, ICONS, type Skin } from "./skin.ts";
import { peek } from "./token.ts";
import { PartyRules } from "./party-rules.ts";

export type { Skin } from "./skin.ts";

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

/** The sign-in client for one app. `signIn`, `finishSignIn`, `login`, `fresh`, `signOut`, `eqosysUrl`, `canSignIn`, `accountChip`, and `achieve` / `achievements`. */
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

  /** Where eqosys is for this page: the live one, or the `<prefix>.eqosys` setting (a local eqosys, `bun run dev` there with loopback returns on). */
  const eqosysUrl = () => (kept.get("eqosys") || url).replace(/\/$/, "");
  /** Whether eqosys would send a player back here: the online game, or a local eqosys for a page on this machine. */
  const canSignIn = () => from.includes(location.origin) || !!kept.get("eqosys");
  /** The page without the handoff's query, where eqosys sends the player back. It must be one of the app's `returns` in eqosys's
   * APPS (each origin's root unless it says otherwise), so sign in from that page. */
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
    waiting.clear();
    const login: Login = { name: got.user.name, email: got.user.email, token: got.token };
    kept.put("login", JSON.stringify(login));
    void sendHeld().then((news) => { for (const u of news) celebrate(u.achievement); });
    return { login, then };
  }

  /** The login kept from the last sign-in, if any. Its token may have run out: see `fresh`. */
  function login(): Login | null {
    try { return check(Login, JSON.parse(kept.get("login") || "null")); } catch { return null; }
  }

  /** Whether the token still has `forMs` to run: long enough for the server to check it when the request lands. */
  const fresh = (l: Login, forMs = 30_000, now = Date.now()) => (peek(l.token)?.exp ?? 0) * 1000 > now + forMs;

  function signOut() { kept.put("login", ""); }

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

  /**
   * The account chip, in `slot`: the eqosys name and a way out, a way in where eqosys can send the player back, or nothing.
   * `note` is what went wrong coming back from eqosys; `onSignOut` runs after signing out (a page that must reload, say).
   */
  function accountChip(slot: HTMLElement, o: { note?: string; onSignOut?: () => void } = {}): HTMLElement {
    wearSkin();
    const who = login();
    slot.classList.add("eq", "eq-chip");
    slot.classList.toggle("in", !!who);
    slot.replaceChildren();
    if (who) slot.append(Object.assign(document.createElement("span"), { className: "eq-who", textContent: who.name, title: who.email }), eqButton({ text: "Sign out", icon: "log-out", onClick: () => { signOut(); accountChip(slot, { onSignOut: o.onSignOut }); o.onSignOut?.(); } }));
    else if (canSignIn()) slot.append(eqButton({ text: "Sign in", icon: "log-in", show: true, onClick: () => void signIn() }));
    if (o.note) slot.append(Object.assign(document.createElement("small"), { className: "eq-note", textContent: o.note }));
    return slot;
  }

  return { signIn, finishSignIn, login, fresh, signOut, who, eqosysUrl, canSignIn, accountChip, report, reportButton, party: partyClient, space: spaceClient, achieve, achievements, sendHeld, celebrate };
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
  { t: "members"; members: PartyMember[] } | { t: "start"; room: string; seat: number } | { t: "refused"; why: string }
  | { t: "say"; from: { id: string; name: string }; text: string; at: number } | { t: "reported"; by: string; id: string; name: string }
  | { t: "rules"; rules: PartyRules; blocked?: { id: string; name: string }[] }
> = (v) => {
  const t = check(obj({ t: oneOf(["members", "start", "refused", "say", "reported", "rules"]) }), v)?.t;
  if (t === "rules") { const r = obj({ rules: PartyRules, blocked: opt(arr(obj({ id: str(200), name: str(200) }), 1000)) })(v); return { t, rules: r.rules, ...(r.blocked && { blocked: r.blocked }) }; }
  if (t === "members") return { t, members: obj({ members: arr(PartyMember, 1000) })(v).members };
  if (t === "start") return { t, ...obj({ room: str(64), seat: int(0, 1000) })(v) };
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
 * `start()`. Everyone hears `onStart({ room, seat })` and carries on in their own world. `onMembers` hears who is in and who is ready.
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
  const onStart = ears<{ room: string; seat: number }>(), onMembers = ears<PartyMember[]>(), onRefused = ears<string>(), onGone = ears<string>();
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
  /** Open the party's socket. `onGone` hears "no such party" or any close that isn't a retry. Joined already: who is in, again. */
  function join(code: string) {
    if (link && joined === code) { if (members) onMembers.hear(members); return; }
    const t = token();
    if (!t) { onGone.hear("Sign in with eqosys first."); return; }
    link?.close();
    joined = code; members = null; lastWhy = "";
    link = connectSocket<PartyMsg, Out>(() => `${url().replace(/^http/, "ws")}/q/party/${encodeURIComponent(code)}`, {
      protocols: [SOCKET_PROTOCOL, t],
      decode: (v) => check(PartyMsg, v),
      queue: 4,
      onMessage: (m) => { if (m.t === "members") onMembers.hear(members = m.members); else if (m.t === "start") onStart.hear(m); else if (m.t === "say") { if (!hidden().has(m.from.id)) onSay.hear(m); } else if (m.t === "reported") onReported.hear(m); else if (m.t === "rules") onRules.hear(m); else onRefused.hear(lastWhy = m.why); },
      onClose: (e) => {
        if (e.code === 4000) { onGone.hear("This party is open in another tab."); return; }
        // The door's refusals (party.ts): its own words came just before the close; stop trying.
        if (e.code === 4403) { onGone.hear(lastWhy || "Only the host's friends can join: ask them to add you on eqosys."); return; }
        if (e.code === 4405 || e.code === 4407 || e.code === 4408) { onGone.hear(lastWhy || "The party didn't let you in."); return; }
        if (e.code === 4406) { onGone.hear("The host took you out of the party."); return; }
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
    /** Host only: quiet a member for the whole party (or `false` to let them speak again). */
    mute: (id: string, on = true) => void link?.send({ t: "mute", id, on }),
    report: (id: string) => void link?.send({ t: "report", id }),
    /** Host only: the party's rules (@rustybuns/util/party-rules), all at once. */
    rules: (rules: PartyRules) => void link?.send({ t: "rules", rules }),
    /** Host only: take a member out (they may come back), block or unblock someone (refused at the door), or hand them the party. */
    kick: (id: string) => void link?.send({ t: "kick", id }),
    block: (id: string, on = true) => void link?.send({ t: "block", id, on }),
    makeHost: (id: string) => void link?.send({ t: "host", id }),
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
