// The world: the project lives here. On the desktop the host runs it in-process
// with sqlite storage, so your groove survives a restart. On Cloudflare the same
// class is a Durable Object, so everyone in a room edits one groove live and hears
// each other play, with a copy in an R2 bucket in case the Durable Object is reset.
// A class with a Durable Object's shape and no base class.
import { apply, decodeClient, lettingGo, sanitize, type Floor, type Full, type Project, type ServerMsg } from "../../src/project.ts";
import { arrive, decodeChatClient, empty, personId, rename, sanitizeChat, say, unsay, type Chat, type ChatClient, type ChatServer } from "../../src/chat.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { TokenBucket } from "@rustybuns/util/limits";
import { check, maybe, obj, oneOf, raw, str } from "@rustybuns/util/guard";

const SAVE_AFTER_MS = 500;
// A room holds this many sockets (ROOM_SEATS online); past it a socket is told so and closed.
export const MAX_SOCKETS = 32;
// Over budget the socket is closed; the client reconnects and takes the snapshot.
export const CLOSE_FLOOD = 4008;
// No seat in this room, or no room free on the edge: the page stops trying and offers the sign-up list.
export const CLOSE_FULL = 4009;
// Per socket: a knob drag sends an op per pointer move; a big message costs more.
const BYTES_PER_TOKEN = 16 * 1024;
// Chat lines a second per socket, and how many can come at once.
const CHAT_RATE = 1, CHAT_BURST = 5;
const LIMITS = {
  maxBytes: 256 * 1024, rate: 120, burst: 240,
  cost: (bytes: number) => 1 + Math.floor(bytes / BYTES_PER_TOKEN),
  onFlood: (ws: RoomSocket) => { try { ws.close(CLOSE_FLOOD, "too many messages"); } catch { /* closing */ } },
};

const REFUSED: Record<Full, string> = {
  room: "this room is full", rooms: "every room is taken", closed: "the maker closed this sesh", code: "this sesh needs its code", tries: "too many wrong codes",
};

interface Stub { fetch(url: string, init?: RequestInit): Promise<Response> }
interface Bucket {
  get(k: string): Promise<{ text(): Promise<string> } | null>;
  put(k: string, v: string): Promise<unknown>;
  delete(k: string): Promise<unknown>;
}
// The bucket copy is a few minutes behind at worst during a jam, and current once the room empties.
export const BACKUP_EVERY_MS = 5 * 60 * 1000;
const backupKey = (room: string) => `sesh/${room}.json`;
const HASH = str(64, { re: /^[0-9a-f]{64}$/ });
/** The bucket copy: the groove, its maker's key hash, the floor and the room code's hash. An older copy is the project alone. */
const Backup = obj({ project: raw, host: maybe(HASH), floor: maybe(oneOf(["free", "held", "closed"])), lock: maybe(HASH) });
// A private sesh lets one address get its code wrong this often a minute, then says so instead of checking.
export const MAX_WRONG = 5;
const WRONG_MS = 60_000;
/** The bindings the edge hands a room (rustybuns.config.ts). The desktop host hands it none. */
export interface WorldEnv {
  LOBBY?: { idFromName(n: string): unknown; get(id: unknown): Stub };
  /** Every sesh's groove, copied out of the Durable Object, so a reset one gets it back. */
  BACKUP?: Bucket;
  ROOM_SEATS?: string;
}
/** `peer` numbers a socket for the live line; 0 is one that was turned away. `host`: it's the sesh's maker. */
type Seat = { userId: string; peer: number; room: string; host: boolean; me?: string };
/** The maker's browser keeps a random key per sesh and sends it as ?key=; the world keeps only its hash. */
const KEY = /^[a-z0-9]{16,64}$/;
const hashKey = async (k: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k)))].map((b) => b.toString(16).padStart(2, "0")).join("");
/** A room code is kept only as a hash, salted with the room so two seshes with one code don't match. */
const hashCode = (room: string, code: string) => hashKey(`${room}\n${code}`);

interface Ctx extends RoomCtx {
  storage: { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown>; setAlarm(at: number): Promise<void>; deleteAlarm(): Promise<void> };
  blockConcurrencyWhile(f: () => Promise<void>): void;
}

export default class World {
  private project: Project | null = null;
  private dirty = false;
  private sockets: Sockets<Seat, ServerMsg | ChatServer>;
  private chat: Chat = empty();
  private chatDirty = false;
  private talk = new WeakMap<RoomSocket, TokenBucket>();
  private lobby: Stub | null;
  private bucket: Bucket | null;
  private seats: number;
  /** Online, the room's name (the Worker says it), which names its backup. */
  private room = "";
  private backupDirty = false;
  private backedUpAt = 0;
  // Online only (the Worker says how long): a room left empty this long is deleted.
  // The desktop never sets it, so your own groove stays.
  private idleMs = 0;
  private idleAt = 0;
  /** The hash of the maker's key: the first visitor with a key claims the sesh. The desktop sends none, so it's always free. */
  private host = "";
  private floor: Floor = "free";
  /** The maker's room code, hashed: "" is a public sesh. */
  private lock = "";
  /** When each address last got the code wrong. */
  private wrong = new Map<string, number[]>();

  constructor(private ctx: Ctx, env: WorldEnv = {}) {
    this.sockets = new Sockets(ctx, LIMITS);
    this.lobby = env.LOBBY ? env.LOBBY.get(env.LOBBY.idFromName("lobby")) : null;
    this.bucket = env.BACKUP ?? null;
    this.seats = Number(env.ROOM_SEATS) > 0 ? Number(env.ROOM_SEATS) : MAX_SOCKETS;
    ctx.blockConcurrencyWhile(async () => {
      this.project = sanitize(await ctx.storage.get("project"));
      this.chat = sanitizeChat(await ctx.storage.get("chat"));
      this.room = String((await ctx.storage.get("room")) ?? "");
      this.idleMs = Number(await ctx.storage.get("idleMs")) || 0;
      this.idleAt = Number(await ctx.storage.get("idleAt")) || 0;
      this.host = String((await ctx.storage.get("host")) ?? "");
      const floor = await ctx.storage.get("floor");
      if (floor === "held" || floor === "closed") this.floor = floor;
      this.lock = String((await ctx.storage.get("lock")) ?? "");
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    const room = request.headers.get("X-Room") ?? "";
    const key = new URL(request.url).searchParams.get("key") ?? "";
    const hash = KEY.test(key) ? await hashKey(key) : "";
    // before anyone claims it: a reset sesh gets its maker and floor back along with the groove
    if (!this.project && this.bucket && room) await this.restore(this.bucket, room);
    if (hash && !this.host) { this.host = hash; this.backupDirty = true; await this.ctx.storage.put("host", hash); }
    const host = !!hash && hash === this.host;
    if (this.floor === "closed" && !host) return this.refuse(userId, "closed");
    if (this.sockets.open().length >= this.seats) return this.refuse(userId, "room");
    // the maker never needs the code; checked before the Lobby, so a wrong one never holds an edge room open
    const locked = !host && room ? await this.locked(room, request) : null;
    if (locked) return this.refuse(userId, locked);
    if (this.lobby && !(await this.admitted(this.lobby, room))) return this.refuse(userId, "rooms");
    const idle = Number(request.headers.get("X-Room-Idle-Ms"));
    if (idle > 0) this.idleMs = idle;
    if (room && room !== this.room) { this.room = room; await this.ctx.storage.put("room", room); }
    const { server, response } = this.sockets.upgrade({ userId, peer: 1 + Math.floor(Math.random() * 2 ** 31), room, host });
    this.sockets.send(server, { t: "snapshot", project: this.project });
    if (this.host) this.sockets.send(server, { t: "floor", state: this.floor, host });
    if (room) this.sockets.send(server, { t: "lock", on: !!this.lock });
    this.broadcastPeers();
    return response;
  }

  /** Storage came back empty but the bucket has the groove: the Durable Object was reset, not the sesh. */
  private async restore(bucket: Bucket, room: string) {
    try {
      const got = await bucket.get(backupKey(room));
      const v: unknown = got && JSON.parse(await got.text());
      const b = check(Backup, v);
      const p = sanitize(b?.project) ?? sanitize(v);
      if (!p || this.project) return;
      this.project = p;
      this.save();
      if (b?.host && !this.host) { this.host = b.host; await this.ctx.storage.put("host", b.host); }
      if (b?.floor && b.floor !== "free") { this.floor = b.floor; await this.ctx.storage.put("floor", b.floor); }
      if (b?.lock && !this.lock) { this.lock = b.lock; await this.ctx.storage.put("lock", b.lock); }
    } catch { /* no copy, or a bad one: the room starts empty */ }
  }

  /** A private sesh lets in whoever brings its code (X-Sesh-Code); null is come in. */
  private async locked(room: string, request: Request): Promise<Full | null> {
    if (!this.lock) return null;
    const code = request.headers.get("X-Sesh-Code") ?? "";
    if (!code) return "code";                        // no guess spent: the page asks for it
    const ip = request.headers.get("CF-Connecting-IP") ?? "", now = Date.now();
    const recent = (this.wrong.get(ip) ?? []).filter((at) => now - at < WRONG_MS);
    if (recent.length >= MAX_WRONG) return "tries";
    if ((await hashCode(room, code)) === this.lock) return null;
    this.wrong.delete(ip);                           // re-insert: the oldest address is first to go
    this.wrong.set(ip, [...recent, now]);
    if (this.wrong.size > 1000) this.wrong.delete(this.wrong.keys().next().value!);
    return "code";
  }

  /** The maker sets, changes or clears the code; everyone in gets the new one so their reconnects work. */
  private async setLock(code: string) {
    if (!this.room) return;                          // the desktop's one world has no door
    this.lock = code ? await hashCode(this.room, code) : "";
    this.backupDirty = true;
    if (this.lock) await this.ctx.storage.put("lock", this.lock);
    else await this.ctx.storage.delete("lock");
    this.broadcast({ t: "lock", on: !!this.lock, code });
  }

  /** A browser can't read why an upgrade failed, so the answer goes down the socket before it closes. */
  private refuse(userId: string, why: Full): Response {
    const { server, response } = this.sockets.upgrade({ userId, peer: 0, room: "", host: false });
    this.sockets.send(server, { t: "full", why });
    try { server.close(CLOSE_FULL, REFUSED[why]); } catch { /* closing */ }
    return response;
  }

  /** Online, the Lobby says whether a room may open (or stay open: each arrival renews its lease). */
  private async admitted(lobby: Stub, room: string): Promise<boolean> {
    try {
      const r = await lobby.fetch("https://lobby/admit", { method: "POST", body: JSON.stringify({ room }) });
      const v: unknown = await r.json();
      return typeof v === "object" && v !== null && "ok" in v && v.ok === true;
    } catch { return true; }                         // a Lobby hiccup doesn't lock everyone out
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw);
    if (!frame) return;
    const msg = decodeClient(frame.value);
    if (!msg) {
      const c = decodeChatClient(frame.value);
      if (c) void this.onChat(ws, c);
      return;
    }
    const seat = this.sockets.who(ws);
    if (msg.t === "floor") { if (seat?.host) void this.setFloor(msg.state); return; }
    if (msg.t === "lock") { if (seat?.host) void this.setLock(msg.code); return; }
    const guest = this.floor !== "free" && !seat?.host;
    if (msg.t === "live") {
      // the live line: in the order it came, to everyone else, kept nowhere (a held room lets a guest only let go)
      if (seat?.peer && !(guest && !lettingGo(msg.e))) this.broadcast({ t: "live", from: seat.peer, e: msg.e }, ws);
      return;
    }
    if (guest) {
      // the maker holds the floor: the edit goes nowhere, and the guest is put back in step
      if (this.project) this.sockets.send(ws, { t: "snapshot", project: this.project });
      return;
    }
    if (msg.t === "init") {
      // first client in an empty world seeds it; later ones get the snapshot instead
      if (this.project) { this.sockets.send(ws, { t: "snapshot", project: this.project }); return; }
      this.project = msg.project;
      this.save();
      this.broadcast({ t: "op", op: { t: "replace", project: msg.project } }, ws);
      return;
    }
    if (msg.t !== "op" || !this.project) return;
    const next = apply(this.project, msg.op);
    if (next === this.project) return;
    this.project = next;
    this.save();
    // rebroadcast the sanitized result for replace, the op itself otherwise
    const op = msg.op.t === "replace" ? { t: "replace" as const, project: next } : msg.op;
    this.broadcast({ t: "op", op }, ws);
  }

  /** The chat: `hello` says who a socket is; lines, renames and deletions only count after it. */
  private async onChat(ws: RoomSocket, m: ChatClient) {
    const seat = this.sockets.who(ws);
    if (!seat?.peer) return;                         // turned away: not in the room
    const me = m.t === "hello" ? await personId(m.key) : seat.me;
    if (!me) return;
    const was = this.chat;
    if (m.t === "hello") {
      this.sockets.attach(ws, { ...seat, me });
      this.chat = arrive(this.chat, me, m.name);
      const { lines, names, maker } = this.chat;
      this.sockets.send(ws, { t: "chat", lines, names, maker, you: me });
      if (this.chat.names !== was.names) this.broadcast({ t: "named", who: me, name: this.chat.names[me] }, ws);
    } else {
      if (m.t === "say") {
        const bucket = this.talk.get(ws) ?? new TokenBucket(CHAT_RATE, CHAT_BURST, Date.now());
        this.talk.set(ws, bucket);
        if (!bucket.take(Date.now())) return;
        this.chat = say(this.chat, me, m.text, Date.now());
        if (this.chat !== was) this.broadcast({ t: "line", line: this.chat.lines[this.chat.lines.length - 1] });
      } else if (m.t === "rename") {
        this.chat = rename(this.chat, me, m.name);
        if (this.chat !== was) this.broadcast({ t: "named", who: me, name: this.chat.names[me] });
      } else {
        this.chat = unsay(this.chat, me, m.id);
        if (this.chat !== was) this.broadcast({ t: "unsaid", id: m.id });
      }
    }
    if (this.chat !== was) this.saveChat();
  }

  /** The maker's call. Closed, everyone else is sent away with the closed card. */
  private async setFloor(state: Floor) {
    this.floor = state;
    this.backupDirty = true;
    await this.ctx.storage.put("floor", state);
    for (const ws of this.sockets.open()) {
      const seat = this.sockets.who(ws);
      if (!seat?.peer) continue;
      if (state === "closed" && !seat.host) {
        this.sockets.send(ws, { t: "full", why: "closed" });
        try { ws.close(CLOSE_FULL, "the maker closed this sesh"); } catch { /* closing */ }
      } else this.sockets.send(ws, { t: "floor", state, host: seat.host });
    }
    this.broadcastPeers();
  }

  webSocketClose(ws: RoomSocket) { this.left(ws); }
  webSocketError(ws: RoomSocket) { this.left(ws); }

  private left(ws: RoomSocket) {
    const seat = this.sockets.who(ws);
    if (!seat?.peer) return;                         // turned away: never counted in
    this.broadcast({ t: "gone", from: seat.peer }, ws);
    this.broadcastPeers();
    if (this.sockets.open().some((w) => w !== ws)) return;
    // the last one out: save now, start the idle clock, and give the room's slot back
    void this.alarm(true);
    if (this.lobby) void this.lobby.fetch("https://lobby/release", { method: "POST", body: JSON.stringify({ room: seat.room }) }).catch(() => {});
  }

  async alarm(lastOut = false) {
    const s = this.ctx.storage;
    if (this.dirty && this.project) {
      this.dirty = false;
      await s.put("project", this.project);
    }
    if (this.chatDirty) {
      this.chatDirty = false;
      await s.put("chat", this.chat);
    }
    if (this.bucket && this.room && this.project && this.backupDirty && (lastOut || Date.now() - this.backedUpAt >= BACKUP_EVERY_MS)) {
      this.backupDirty = false;
      this.backedUpAt = Date.now();
      try { await this.bucket.put(backupKey(this.room), JSON.stringify({ project: this.project, host: this.host, floor: this.floor, lock: this.lock || undefined })); } catch { this.backupDirty = true; }
    }
    if (!this.idleMs || this.sockets.open().length) return;
    if (!lastOut && this.idleAt && Date.now() >= this.idleAt) {
      // nobody came back: the room goes, groove and all
      await s.deleteAlarm();
      for (const k of ["project", "chat", "idleMs", "idleAt", "room", "host", "floor", "lock"]) await s.delete(k);
      if (this.bucket && this.room) await this.bucket.delete(backupKey(this.room)).catch(() => {});
      this.project = null;
      this.chat = empty();
      this.idleAt = 0;
      this.host = "";
      this.floor = "free";
      this.lock = "";
      return;
    }
    if (!this.project) return;                       // nothing stored, nothing to clean up
    if (lastOut || !this.idleAt) {
      this.idleAt = Date.now() + this.idleMs;
      await s.put("idleMs", this.idleMs);
      await s.put("idleAt", this.idleAt);
    }
    await s.setAlarm(this.idleAt);
  }

  private save() {
    this.backupDirty = true;
    if (this.dirty) return;
    this.dirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private saveChat() {
    if (this.chatDirty) return;
    this.chatDirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private broadcast(m: ServerMsg | ChatServer, except?: RoomSocket) { this.sockets.broadcast(m, except); }

  private broadcastPeers() {
    this.broadcast({ t: "peers", n: this.sockets.open().length });
  }
}
