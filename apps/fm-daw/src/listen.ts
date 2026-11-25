// A listen link (#5878): one Durable Object per live set relays the DJ's sound to everyone who opens the link, no
// sign-in and no seat. The decks send a WebM chunk a second over their socket; the object keeps the stream's header
// (everything before its first cluster) and the bytes since the latest cluster starts, so a listener who comes in late
// gets a stream their player can start on, then every chunk after it. Nothing is stored but the hash of the DJ's key
// (so nobody else can take their link): the sound only passes through. When the DJ's socket closes, the set ends, every
// listener is told and let go, and the object has nothing left to wake for.
import { TokenBucket } from "@rustybuns/util/limits";
import { refuseSocket, type RoomSocket } from "@rustybuns/util/room";
import { check } from "@rustybuns/util/guard";
import { sha256 } from "@rustybuns/util/bytes";
import { CUES_MAX, DJ_KEY, DjSays, NAME_MAX, type SetSays } from "./dj/live-wire.ts";

/** Listeners one set takes at once (LISTEN_EARS overrides). */
export const MAX_EARS = 200;
/** Bytes one chunk from the decks may be: a second at 128 kb/s is 16 KB. */
export const CHUNK_MAX = 256 * 1024;
/** Bytes kept since the latest cluster start for a late listener; past it, a late listener waits for the next one. */
export const TAIL_MAX = 2 * 1024 * 1024;
/** Close codes: a listener past the cap, a DJ with the wrong key, the set over. */
export const CLOSE_FULL = 4001, CLOSE_NOT_YOURS = 4003, CLOSE_ENDED = 4000, CLOSE_REPLACED = 4002;

/** A WebM Cluster element's id: where a player can start. */
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
/** Where the last cluster starts in `b`, or -1. */
export function lastCluster(b: Uint8Array): number {
  for (let i = b.length - 4; i >= 0; i--) if (b[i] === CLUSTER[0] && b[i + 1] === CLUSTER[1] && b[i + 2] === CLUSTER[2] && b[i + 3] === CLUSTER[3]) return i;
  return -1;
}
const join = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** The stream as a late listener needs it: the header, then everything since a cluster began. */
export class LateStart {
  private head: Uint8Array[] = [];
  private headDone = false;
  private tail: Uint8Array[] = [];
  private tailBytes = 0;
  /** A chunk of the stream, in order. */
  push(b: Uint8Array) {
    const at = lastCluster(b);
    if (!this.headDone) {
      if (at < 0) { this.head.push(b); return; }
      // the header ends where the first cluster starts; a chunk holds at most a few, so the first is found from the front
      let first = at;
      for (let i = at - 1; i >= 0; i--) if (b[i] === CLUSTER[0] && b[i + 1] === CLUSTER[1] && b[i + 2] === CLUSTER[2] && b[i + 3] === CLUSTER[3]) first = i;
      this.head.push(b.subarray(0, first));
      this.headDone = true;
      this.restart(b.subarray(at));
      return;
    }
    // a cluster id split across two chunks isn't seen: the tail just runs on from the cluster before it, still playable
    if (at >= 0) this.restart(b.subarray(at));
    else if (this.tailBytes && this.tailBytes + b.length <= TAIL_MAX) { this.tail.push(b); this.tailBytes += b.length; }
    else { this.tail = []; this.tailBytes = 0; }
  }
  private restart(b: Uint8Array) { this.tail = [b]; this.tailBytes = b.length; }
  /** What a listener who joins now is sent first, or null before a cluster has begun. */
  start(): Uint8Array | null {
    return this.headDone && this.tailBytes ? join([...this.head, ...this.tail]) : null;
  }
}

type Role = "dj" | "ear";
interface Sock extends RoomSocket { deserializeAttachment(): unknown; serializeAttachment(v: unknown): void }
interface Ctx {
  acceptWebSocket(ws: RoomSocket, tags?: string[]): void;
  getWebSockets(tag?: string): RoomSocket[];
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> };
  blockConcurrencyWhile<T>(f: () => Promise<T>): Promise<T>;
}
interface Env { LISTEN_EARS?: string }
interface UpgradeInit extends ResponseInit { webSocket: unknown }
declare const WebSocketPair: { new (): Record<0 | 1, Sock & { accept(): void }> };

export default class Listen {
  /** Hash of the key that first went live on this link; only it may go live here again. */
  private owner: string | null = null;
  private name = "";
  private cues: NonNullable<SetSays["cues"]> = [];
  private late = new LateStart();
  private bucket = new TokenBucket(4, 12, Date.now());
  private maxEars: number;

  constructor(private ctx: Ctx, env: Env = {}) {
    this.maxEars = Math.max(1, Number(env.LISTEN_EARS) || MAX_EARS);
    void ctx.blockConcurrencyWhile(async () => { this.owner = (await ctx.storage.get<string>("owner")) ?? null; });
  }

  private role(ws: RoomSocket): Role | null {
    const a = (ws as Sock).deserializeAttachment();
    return a === "dj" || a === "ear" ? a : null;
  }
  /** Sockets of a role still open (the platform can list one that is closing), but `not`. */
  private open(role: Role, not?: RoomSocket) {
    return this.ctx.getWebSockets(role).filter((w) => w !== not && (w.readyState === undefined || w.readyState === 1) && this.role(w) === role);
  }
  private dj(not?: RoomSocket) { return this.open("dj", not)[0] ?? null; }
  private ears(not?: RoomSocket) { return this.open("ear", not); }
  private say(ws: RoomSocket, m: SetSays) { try { ws.send(JSON.stringify(m)); } catch { /* closing */ } }
  private sayAll(m: SetSays) { const s = JSON.stringify(m); for (const ws of this.ears()) try { ws.send(s); } catch { /* closing */ } }
  private count(not?: RoomSocket) {
    const m: SetSays = { t: "ears", ears: this.ears(not).length };
    for (const ear of this.ears(not)) this.say(ear, m);
    const dj = this.dj(not);
    if (dj) this.say(dj, m);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("a listen link's socket", { status: 426 });
    const key = new URL(req.url).searchParams.get("dj");
    let role: Role = "ear";
    if (key !== null) {
      if (!DJ_KEY.test(key)) return refuseSocket("not a DJ key", CLOSE_NOT_YOURS, "not yours");
      const hash = await sha256(key);
      if (this.owner && this.owner !== hash) return refuseSocket("this link is someone else's", CLOSE_NOT_YOURS, "not yours");
      if (!this.owner) { this.owner = hash; await this.ctx.storage.put("owner", hash); }
      role = "dj";
    } else if (this.ears().length >= this.maxEars) return refuseSocket("this set is full", CLOSE_FULL, "full");
    const pair = new WebSocketPair(), server = pair[1];
    if (role === "dj") {
      // one live set per DJ: a second tab going live on the same link takes over, and the stream starts over
      for (const old of this.ctx.getWebSockets("dj")) { (old as Sock).serializeAttachment("old"); try { old.close(CLOSE_REPLACED, "live elsewhere"); } catch { /* gone */ } }
      this.late = new LateStart();
      this.cues = [];
    }
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(role);
    if (role === "ear") {
      const live = !!this.dj();
      this.say(server, { t: "set", name: this.name, live, cues: this.cues });
      const start = live ? this.late.start() : null;
      if (start) try { server.send(start); } catch { /* closing */ }
    }
    this.count();
    const init: UpgradeInit = { status: 101, webSocket: pair[0] };
    return new Response(null, init);
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    if (this.role(ws) !== "dj") return;                            // listeners only listen
    if (typeof raw !== "string") {
      if (raw.byteLength > CHUNK_MAX || !this.bucket.take(Date.now())) return;
      const b = new Uint8Array(raw), fresh = this.late.start() === null;
      this.late.push(b);
      for (const ear of this.ears()) {
        // a listener who came before the first cluster gets the start once there is one, then chunks as they come
        if (fresh) { const s = this.late.start(); if (s) try { ear.send(s); } catch { /* closing */ } }
        else try { ear.send(b); } catch { /* closing */ }
      }
      return;
    }
    if (raw.length > 4096) return;
    let v: unknown;
    try { v = JSON.parse(raw); } catch { return; }
    const m = check(DjSays, v);
    if (!m) return;
    if (m.t === "name") { this.name = (m.name ?? "").slice(0, NAME_MAX); this.sayAll({ t: "set", name: this.name, live: true, cues: this.cues }); }
    else if (m.cue) { this.cues = [...this.cues, m.cue].slice(-CUES_MAX); this.sayAll({ t: "cue", cue: m.cue }); }
  }

  webSocketClose(ws: RoomSocket) {
    const role = this.role(ws);
    if (role === "dj" && !this.dj(ws)) {
      // the set is over: tell everyone, let them go, forget the stream
      for (const ear of this.ears()) { this.say(ear, { t: "end" }); try { ear.close(CLOSE_ENDED, "set over"); } catch { /* gone */ } }
      this.late = new LateStart();
      this.cues = [];
      this.name = "";
      return;
    }
    if (role === "ear") this.count(ws);
  }
  webSocketError(ws: RoomSocket) { this.webSocketClose(ws); }
}
