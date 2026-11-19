// The world connection. On the desktop it's the host's in-process world, which
// saves the project to sqlite. On Cloudflare it's a Durable Object per room, so
// everyone in the room edits one groove and hears each other play (the live line).
// With no world (plain `vite dev`), the app still works; it just doesn't save.
import { connectSocket } from "@rustybuns/util/socket";
import { seshFromPath } from "../sesh.ts";
import { decodeServer, type ClientMsg, type Floor, type Full, type Live, type Op, type Project, type ServerMsg } from "../project.ts";
import type { TakeBytes } from "../take.ts";
import type { Rung } from "../rewind.ts";
import { decodeChatServer, type ChatClient, type ChatServer } from "../chat.ts";
import { decodeGrantServer, type GrantClient, type GrantServer } from "../grants.ts";
import { decodeRtcServer, type Line, type RtcClient, type RtcServer, type Signal } from "../guitar.ts";
import { decodeClockServer, type ClockClient, type ClockServer } from "../clock.ts";
import { decodeStudioServer, type StudioClient, type StudioOp, type StudioServer } from "../studio.ts";

/** `locked`: the sesh is private (it has a code). */
export type NetStatus = { state: "connecting" | "online" | "offline" | "full"; peers: number; full?: Full; floor?: FloorState; locked?: boolean };
/** Who may change the sesh, and whether that's you. None on the desktop or in a sesh with no maker. */
export type FloorState = { state: Floor; host: boolean };

export interface Net {
  send(op: Op): void;
  /** Seed an empty world with this project. */
  init(project: Project): void;
  /** One live event to everyone else in the room; dropped while offline (a late note is a wrong note). */
  live(e: Live): void;
  /** A chat message; dropped while offline (the room needs the hello that opens each socket first). */
  chat(m: ChatClient): void;
  /** The maker only (the world ignores anyone else): free, held or closed. */
  floor(state: Floor): void;
  /** A chunk of a take's sound, sent before the op that puts the take on a track. */
  take(m: TakeBytes): void;
  /** The maker only: make the sesh private with this code, or public again with "". */
  lock(code: string): void;
  /** A leader grants, hands on or answers; anyone asks. Dropped while offline, like chat. */
  grant(m: GrantClient): void;
  /** Ask for the groove as it was `ago` minutes back, for this page alone; it comes back through onRewound. */
  rewind(ago: Rung): void;
  /** A guitar call's setup for one other person (src/guitar.ts); dropped while offline. */
  rtc(to: number, line: Line, s: Signal): void;
  /** The shared clock: a ping to the leader, or (the leader) an answer to one (src/clock.ts); dropped while offline. */
  clock(m: ClockClient): void;
  /** One thing done in the sesh's gear room (src/studio.ts); dropped while offline (the room is sent whole on the way back in). */
  studio(op: StudioOp): void;
  close(): void;
}

/** This browser's key to a sesh: the first one to bring a key to a sesh is its maker. */
function seshKey(room: string): string {
  const name = `fm-daw:key:${room}`;
  try {
    const had = localStorage.getItem(name);
    if (had && /^[a-z0-9]{16,64}$/.test(had)) return had;
  } catch { /* private window: a key for this visit only */ }
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(name, key); } catch { /* as above */ }
  return key;
}

/** Online the sesh is the path (/sesh/fuzzy-black-panda); the desktop has one world and no name. */
export const roomName = () => seshFromPath(location.pathname) ?? new URLSearchParams(location.search).get("room");

/** A private sesh's code, kept in this browser once typed (or set here), so a reconnect or a revisit gets in. */
const codeKey = (room: string) => `fm-daw:code:${room}`;
export function savedCode(room: string | null): string {
  try { return (room && localStorage.getItem(codeKey(room))) || ""; } catch { return ""; }
}
export function saveCode(room: string | null, code: string) {
  if (!room) return;
  try { if (code) localStorage.setItem(codeKey(room), code); else localStorage.removeItem(codeKey(room)); } catch { /* private window: ask again next time */ }
}

/**
 * A bounce filed with this sesh online, so a DJ's deck can play it (Sound Guy Simulator's live set): the sesh's name is
 * all the deck needs. Each bounce replaces the last. False on the desktop (no sesh) or when the edge said no.
 */
export async function shareBounce(wav: Uint8Array, bpm: number): Promise<boolean> {
  const room = seshFromPath(location.pathname);
  if (!room) return false;
  const url = new URL(`/sesh/${room}/bounce`, location.href);
  url.searchParams.set("bpm", String(bpm));
  url.searchParams.set("key", seshKey(room));
  const code = savedCode(room);
  if (code) url.searchParams.set("code", code);
  try { return (await fetch(url, { method: "PUT", body: wav as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "audio/wav" } })).ok; } catch { return false; }
}

export function connect(opts: {
  /** Called with the saved project, or null when the world is empty. */
  onSnapshot(p: Project | null): void;
  onOp(op: Op): void;
  onLive(from: number, e: Live): void;
  /** Someone left: let go of whatever they were holding. */
  onGone(from: number): void;
  onStatus(s: NetStatus): void;
  onChat(m: ChatServer): void;
  /** Who may do what, who has a hand up, and who's in (the jam room has no use for it yet). */
  onGrants?(m: GrantServer): void;
  /** A chunk of a take's sound (someone recorded one, or the room has it from before). */
  onTakeBytes(m: TakeBytes): void;
  /** The groove this page asked for (null: the sesh doesn't go back that far), as of `at` (ms). */
  onRewound?(ago: Rung, at: number, p: Project | null): void;
  /** A guitar call's setup from someone (the jam room's guitar line). */
  onRtc?(m: RtcServer): void;
  /** Someone's clock ping (you lead), or the answer to yours. */
  onClock?(m: ClockServer): void;
  /** The sesh's gear room: all of it on joining, then each thing someone does in it (src/studio.ts). */
  onStudio?(m: StudioServer): void;
  /** Who this is, said on every open so the room knows the chat's people. */
  hello(): { key: string; name: string };
  /** An eqosys token, asked on every try (it lasts minutes): the Worker seats you under your eqosys id. Null plays as a guest. */
  token?: () => string | null;
}): Net {
  const room = roomName();
  const url = new URL(`ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws`);
  if (room) { url.searchParams.set("room", room); url.searchParams.set("key", seshKey(room)); }
  const code = savedCode(room);
  if (code) url.searchParams.set("code", code);
  let peers = 0;
  let floor: FloorState | undefined;
  let locked = false;
  let full: Full | null = null;
  opts.onStatus({ state: "connecting", peers });
  const link = connectSocket<ServerMsg | ChatServer | GrantServer | RtcServer | ClockServer | StudioServer, ClientMsg | ChatClient | GrantClient | RtcClient | ClockClient | StudioClient>(() => {
    const t = opts.token?.();
    if (!t) return url;
    const signed = new URL(url);
    signed.searchParams.set("token", t);
    return signed;
  }, {
    decode: (v) => decodeServer(v) ?? decodeChatServer(v) ?? decodeGrantServer(v) ?? decodeRtcServer(v) ?? decodeClockServer(v) ?? decodeStudioServer(v), queue: 200,
    onMessage: (m) => {
      if (m.t === "snapshot") { opts.onSnapshot(m.project); opts.onStatus({ state: "online", peers, floor, locked }); }
      else if (m.t === "op") opts.onOp(m.op);
      else if (m.t === "live") opts.onLive(m.from, m.e);
      else if (m.t === "gone") opts.onGone(m.from);
      else if (m.t === "peers") { peers = m.n; opts.onStatus({ state: "online", peers, floor, locked }); }
      else if (m.t === "floor") { floor = { state: m.state, host: m.host }; opts.onStatus({ state: "online", peers, floor, locked }); }
      else if (m.t === "full") full = m.why;
      else if (m.t === "takeBytes") opts.onTakeBytes(m);
      else if (m.t === "grants") opts.onGrants?.(m);
      else if (m.t === "rewound") opts.onRewound?.(m.ago, m.at, m.project);
      else if (m.t === "rtc") opts.onRtc?.(m);
      else if (m.t === "tick" || m.t === "tock") opts.onClock?.(m);
      else if (m.t === "studio-all" || m.t === "studio-op") opts.onStudio?.(m);
      else if (m.t === "lock") {
        // the maker changed it: keep the new one, or this tab's next reconnect is turned away
        if (m.code !== undefined) { saveCode(room, m.code); if (m.code) url.searchParams.set("code", m.code); else url.searchParams.delete("code"); }
        locked = m.on;
        opts.onStatus({ state: "online", peers, floor, locked });
      }
      else opts.onChat(m);
    },
    onClose: (e) => {
      // turned away: stay closed until the player asks again
      if (full) { opts.onStatus({ state: "full", peers: 0, full }); return null; }
      opts.onStatus({ state: "offline", peers: 0 });
      // a few quick retries (host restarting), then back off; no world just stays offline
      return Math.min(1000 * 2 ** (e.tries - 1), 30000);
    },
    onOpen: () => { opts.onStatus({ state: "connecting", peers, floor }); link.send({ t: "hello", ...opts.hello() }); },
  });
  return {
    send: (op) => { link.send({ t: "op", op }); },
    init: (project) => { link.send({ t: "init", project }); },
    live: (e) => { if (link.open) link.send({ t: "live", e }); },
    chat: (m) => { if (link.open) link.send(m); },
    floor: (state) => { link.send({ t: "floor", state }); },
    lock: (code) => { link.send({ t: "lock", code }); },
    grant: (m) => { if (link.open) link.send(m); },
    take: (m) => { link.send(m); },
    rewind: (ago) => { if (link.open) link.send({ t: "rewind", ago }); },
    rtc: (to, line, s) => { if (link.open) link.send({ t: "rtc", to, line, s }); },
    clock: (m) => { if (link.open) link.send(m); },
    studio: (step) => { if (link.open) link.send({ t: "studio", op: step }); },
    close: () => link.close(),
  };
}
