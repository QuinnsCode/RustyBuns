// The world: the project lives here. On the desktop the host runs it in-process
// with sqlite storage, so your groove survives a restart. On Cloudflare the same
// class is a Durable Object, so everyone in a room edits one groove live and hears
// each other play, with a copy in an R2 bucket in case the Durable Object is reset.
// A class with a Durable Object's shape and no base class.
import { apply, decodeClient, lettingGo, sanitize, type Floor, type Full, type Project, type ServerMsg } from "../../src/project.ts";
import { decodeChatClient, empty, personId, rename, sanitizeChat, say, unsay, type Chat, type ChatClient, type ChatServer } from "../../src/chat.ts";
import { applyStudio, decodeStudioClient, emptyStudio, letGo, sanitizePatch, type Studio, type StudioOp, type StudioServer } from "../../src/studio.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { TokenBucket } from "@rustybuns/util/limits";
import { arr, check, int, maybe, obj, oneOf, raw, rec, str } from "@rustybuns/util/guard";
import { decodeGrantClient, grant, handOn, may, needs, noGrants, sanitizeGrants, type Can, type GrantClient, type Grants, type GrantServer } from "../../src/grants.ts";
import { MAX_CHUNKS, MAX_TAKES, TakeBytesGuard, type TakeBytes } from "../../src/take.ts";
import { BackupLadder, LadderGuard, MINUTE, pick, thin, type Ladder, type Rung } from "../../src/rewind.ts";

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
/** The bucket copy: the groove, its maker's key hash, the floor, the room code's hash, the studio's patch, who may do what and the wind-back ladder. An older copy is the project alone. */
const Backup = obj({ project: raw, host: maybe(HASH), floor: maybe(oneOf(["free", "held", "closed"])), lock: maybe(HASH), studio: raw, grants: raw, ladder: raw });
/** One rung of the wind-back ladder in storage: the groove at the start of that minute (src/rewind.ts). */
const snapKey = (minute: number) => `snap:${minute}`;
// Takes kept at once, used or not: the ones on tracks, plus what undo may bring back until the room empties.
const MAX_STORED_TAKES = MAX_TAKES * 3;
const takeKey = (id: string, i: number) => `take:${id}:${i}`;
/** The take ids on a project's tracks. */
const takeIds = (p: Project | null) => new Set((p?.tracks ?? []).flatMap((t) => (t.take ? [t.take.id] : [])));
const TakeIndex = rec(int(1, MAX_CHUNKS), MAX_STORED_TAKES);
/** A whole take in the bucket, written once (a take never changes): its chunks in order. */
const bucketTakeKey = (room: string, id: string) => `sesh/${room}/take/${id}.json`;
const BucketTake = arr(str(Math.ceil((MAX_CHUNKS * 96 * 1024 * 4) / 3), { min: 1 }), MAX_CHUNKS, { min: 1 });
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
  private sockets: Sockets<Seat, ServerMsg | ChatServer | StudioServer | GrantServer>;
  /** The studio in this sesh: its patch is saved with the groove, who holds what only lives while they're in. */
  private studio: Studio = emptyStudio();
  private studioDirty = false;
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
  /** Who the leader let do what (src/grants.ts), kept beside the groove; the raised hands only live while their people are in. */
  private grants: Grants = noGrants();
  private asks: Record<string, Can> = {};
  /** The maker's room code, hashed: "" is a public sesh. */
  private lock = "";
  /** When each address last got the code wrong. */
  private wrong = new Map<string, number[]>();
  /** Every whole take in storage, id to how many chunks it is. */
  private takes: Record<string, number> = {};
  /** Takes still coming in: the chunk numbers here so far. */
  private arriving = new Map<string, { n: number; got: Set<number> }>();
  /** The wind-back ladder: which minutes' grooves are kept, and when the groove last changed. */
  private ladder: Ladder = { snaps: [], edited: 0 };

  constructor(private ctx: Ctx, env: WorldEnv = {}) {
    this.sockets = new Sockets(ctx, LIMITS);
    this.lobby = env.LOBBY ? env.LOBBY.get(env.LOBBY.idFromName("lobby")) : null;
    this.bucket = env.BACKUP ?? null;
    this.seats = Number(env.ROOM_SEATS) > 0 ? Number(env.ROOM_SEATS) : MAX_SOCKETS;
    ctx.blockConcurrencyWhile(async () => {
      this.project = sanitize(await ctx.storage.get("project"));
      this.chat = sanitizeChat(await ctx.storage.get("chat"));
      this.studio = { patch: sanitizePatch(await ctx.storage.get("studio")), held: {} };
      this.room = String((await ctx.storage.get("room")) ?? "");
      this.idleMs = Number(await ctx.storage.get("idleMs")) || 0;
      this.idleAt = Number(await ctx.storage.get("idleAt")) || 0;
      this.host = String((await ctx.storage.get("host")) ?? "");
      const floor = await ctx.storage.get("floor");
      if (floor === "held" || floor === "closed") this.floor = floor;
      this.lock = String((await ctx.storage.get("lock")) ?? "");
      this.grants = sanitizeGrants(await ctx.storage.get("grants"));
      this.takes = check(TakeIndex, await ctx.storage.get("takes")) ?? {};
      this.ladder = check(LadderGuard, await ctx.storage.get("ladder")) ?? this.ladder;
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
    void this.sendTakes(takeIds(this.project), [server]);
    if (this.studioUsed()) this.sockets.send(server, { t: "studio-all", studio: this.studio });
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
      // a studio with no groove yet is a sesh too
      if (b?.studio && !this.studioUsed()) { this.studio = { patch: sanitizePatch(b.studio), held: {} }; this.saveStudio(); }
      if (!p || this.project) return;
      this.project = p;
      this.save();
      await this.restoreTakes(bucket, room, takeIds(p));
      if (b?.host && !this.host) { this.host = b.host; await this.ctx.storage.put("host", b.host); }
      if (b?.floor && b.floor !== "free") { this.floor = b.floor; await this.ctx.storage.put("floor", b.floor); }
      if (b?.lock && !this.lock) { this.lock = b.lock; await this.ctx.storage.put("lock", b.lock); }
      if (b?.grants) { this.grants = sanitizeGrants(b.grants); await this.ctx.storage.put("grants", this.grants); }
      const ladder = check(BackupLadder, b?.ladder);
      if (ladder) {
        const snaps: number[] = [];
        for (const { at, project } of ladder.snaps) {
          const was = sanitize(project);
          if (was) { await this.ctx.storage.put(snapKey(at), was); snaps.push(at); }
        }
        this.ladder = { edited: ladder.edited, snaps: thin(snaps, Math.floor(Date.now() / MINUTE)) };
        await this.ctx.storage.put("ladder", this.ladder);
      }
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
      const st = decodeStudioClient(frame.value);
      if (st) { this.onStudio(ws, st.op); return; }
      const g = decodeGrantClient(frame.value);
      if (g) { void this.onGrant(ws, g); return; }
      const c = decodeChatClient(frame.value);
      if (c) void this.onChat(ws, c);
      return;
    }
    const seat = this.sockets.who(ws);
    // every message is checked against what its sender may do, here and not only in the page
    const allowed = this.may(seat, needs(msg));
    if (msg.t === "floor") { if (allowed) void this.setFloor(msg.state); return; }
    if (msg.t === "lock") { if (allowed) void this.setLock(msg.code); return; }
    // a look back is for this page alone, so anyone in may ask, whatever their grants
    if (msg.t === "rewind") { if (seat?.peer) void this.rewind(ws, msg.ago); return; }
    if (msg.t === "live") {
      // the live line: in the order it came, to everyone else, kept nowhere (no play grant lets one only let go)
      if (seat?.peer && (allowed || lettingGo(msg.e))) this.broadcast({ t: "live", from: seat.peer, e: msg.e }, ws);
      return;
    }
    if (msg.t === "takeBytes") { if (allowed) this.onTakeBytes(ws, msg); return; }
    if (!allowed) {
      // no grant for it: the edit goes nowhere, and its sender is put back in step
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
    // a take goes on a track only once all of its sound is here
    if (msg.op.t === "take" && msg.op.take && !this.takes[msg.op.take.id]) { this.sockets.send(ws, { t: "snapshot", project: this.project }); return; }
    const had = takeIds(this.project);
    const next = apply(this.project, msg.op);
    if (next === this.project) return;
    this.capture(this.project);
    this.project = next;
    this.save();
    // rebroadcast the sanitized result for replace, the op itself otherwise
    const op = msg.op.t === "replace" ? { t: "replace" as const, project: next } : msg.op;
    // an undo can bring back a take the others never heard: its sound goes before the edit
    if (msg.op.t === "replace") void this.sendTakes(new Set([...takeIds(next)].filter((id) => !had.has(id))), this.sockets.open().filter((w) => w !== ws));
    this.broadcast({ t: "op", op }, ws);
  }

  /**
   * The first edit of each minute puts the groove as it was before it on the ladder (as of that minute's start),
   * and the ladder is thinned to its rungs. A minute nobody edits adds nothing: the groove was the one before.
   */
  private capture(was: Project) {
    const m = Math.floor(Date.now() / MINUTE);
    const last = this.ladder.snaps.at(-1);
    if (last !== undefined && last >= m) return;
    const kept = thin([...this.ladder.snaps, m], m);
    const s = this.ctx.storage;
    void s.put(snapKey(m), was);
    for (const at of this.ladder.snaps) if (!kept.includes(at)) void s.delete(snapKey(at));
    this.ladder = { ...this.ladder, snaps: kept };
    void s.put("ladder", this.ladder);
    this.backupDirty = true;
  }

  /** The groove `ago` minutes back, to this socket only, with the sound of any take on it the page hasn't had. */
  private async rewind(ws: RoomSocket, ago: Rung) {
    const now = Date.now(), got = pick(this.ladder, now, ago);
    const project = got === "now" ? this.project : got === null ? null : sanitize(await this.ctx.storage.get(snapKey(got)));
    const at = typeof got === "number" ? got * MINUTE : Math.max(0, now - ago * MINUTE);
    this.sockets.send(ws, { t: "rewound", ago, at, project });
    const have = takeIds(this.project);
    if (project) await this.sendTakes(new Set([...takeIds(project)].filter((id) => !have.has(id))), [ws]);
  }

  /** A chunk of a take's sound: kept, and passed on so the others have it before the take lands on a track. */
  private onTakeBytes(ws: RoomSocket, m: TakeBytes) {
    if (this.takes[m.id]) return;                    // already whole
    let a = this.arriving.get(m.id);
    if (!a || a.n !== m.n) {
      if (Object.keys(this.takes).length + this.arriving.size >= MAX_STORED_TAKES) return;
      this.arriving.set(m.id, (a = { n: m.n, got: new Set() }));
    }
    a.got.add(m.i);
    void this.ctx.storage.put(takeKey(m.id, m.i), m.data);
    this.broadcast(m, ws);
    if (a.got.size < a.n) return;
    this.arriving.delete(m.id);
    this.takes = { ...this.takes, [m.id]: m.n };
    void this.ctx.storage.put("takes", this.takes);
    void this.backUpTake(m.id, m.n);
  }

  /** A whole take's sound to the bucket, so a reset Durable Object gets it back with the groove. */
  private async backUpTake(id: string, n: number) {
    if (!this.bucket || !this.room) return;
    const chunks: string[] = [];
    for (let i = 0; i < n; i++) {
      const data = await this.ctx.storage.get(takeKey(id, i));
      if (typeof data !== "string") return;
      chunks.push(data);
    }
    await this.bucket.put(bucketTakeKey(this.room, id), JSON.stringify(chunks)).catch(() => {});
  }

  /** The takes on a restored groove, out of the bucket and back into storage. */
  private async restoreTakes(bucket: Bucket, room: string, ids: Set<string>) {
    for (const id of ids) {
      try {
        const got = await bucket.get(bucketTakeKey(room, id));
        const chunks = check(BucketTake, got && JSON.parse(await got.text()));
        // each chunk is checked as the socket would check it
        if (!chunks || chunks.some((data, i) => !check(TakeBytesGuard, { t: "takeBytes", id, i, n: chunks.length, data }))) continue;
        for (let i = 0; i < chunks.length; i++) await this.ctx.storage.put(takeKey(id, i), chunks[i]);
        this.takes = { ...this.takes, [id]: chunks.length };
      } catch { /* no copy: the take stays named on its track, silent */ }
    }
    await this.ctx.storage.put("takes", this.takes);
  }

  /** These takes' sound, chunk by chunk, to these sockets. */
  private async sendTakes(ids: Set<string>, to: RoomSocket[]) {
    for (const id of ids) {
      const n = this.takes[id];
      if (!n || !to.length) continue;
      for (let i = 0; i < n; i++) {
        const data = await this.ctx.storage.get(takeKey(id, i));
        if (typeof data !== "string") break;
        for (const ws of to) this.sockets.send(ws, { t: "takeBytes", id, i, n, data });
      }
    }
  }

  /** Takes in storage that aren't in `keep` go. Chunks still arriving are dropped too: their sender left. */
  private async dropTakes(keep: Set<string>) {
    const s = this.ctx.storage;
    const gone = Object.entries(this.takes).filter(([id]) => !keep.has(id));
    for (const [id, a] of this.arriving) gone.push([id, a.n]);
    this.arriving.clear();
    if (!gone.length) return;
    for (const [id, n] of gone) {
      for (let i = 0; i < n; i++) await s.delete(takeKey(id, i));
      if (this.bucket && this.room) await this.bucket.delete(bucketTakeKey(this.room, id)).catch(() => {});
    }
    this.takes = Object.fromEntries(Object.entries(this.takes).filter(([id]) => keep.has(id)));
    if (Object.keys(this.takes).length) await s.put("takes", this.takes); else await s.delete("takes");
  }
  /**
   * The studio: the world is the one that says who got the amp, so each op is applied here first and passed on
   * to everyone (the player who did it too) only when it changed something. Refused, or a guest while the maker
   * holds the floor, the player gets the whole studio back to put them in step.
   */
  private onStudio(ws: RoomSocket, op: StudioOp) {
    const seat = this.sockets.who(ws);
    if (!seat?.peer) return;                         // turned away: not in the room
    const next = this.may(seat, "play") ? applyStudio(this.studio, seat.peer, op) : this.studio;
    if (next === this.studio) { this.sockets.send(ws, { t: "studio-all", studio: this.studio }); return; }
    const saved = next.patch !== this.studio.patch;
    this.studio = next;
    if (saved) this.saveStudio();
    this.broadcast({ t: "studio-op", from: seat.peer, op });
  }

  private studioUsed() { return this.studio.patch.placed.length > 0 || Object.keys(this.studio.held).length > 0; }

  /** The chat: `hello` says who a socket is; lines, renames and deletions only count after it. */
  private async onChat(ws: RoomSocket, m: ChatClient) {
    const seat = this.sockets.who(ws);
    if (!seat?.peer) return;                         // turned away: not in the room
    const me = m.t === "hello" ? await personId(m.key) : seat.me;
    if (!me) return;
    const was = this.chat;
    if (m.t === "hello") {
      this.sockets.attach(ws, { ...seat, me });
      this.chat = rename(this.chat, me, m.name);
      const { lines, names } = this.chat;
      this.sockets.send(ws, { t: "chat", lines, names, you: me, host: seat.host });
      if (this.chat.names !== was.names) this.broadcast({ t: "named", who: me, name: this.chat.names[me] }, ws);
      // the maker's key names the maker's person, who leads; everyone hears who may do what once they're named
      if (seat.host && this.grants.maker !== me) await this.setGrants({ ...this.grants, maker: me });
      else if (this.host) this.broadcast(this.grantsMsg());
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
        if (this.may(seat, "lead")) this.chat = unsay(this.chat, m.id);
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

  /** Whether this socket's person may do this now (src/grants.ts); null needs nothing. Turned away, nothing. */
  private may(seat: Seat | null | undefined, can: Can | null): boolean {
    if (!seat?.peer) return false;
    return can === null || may(this.grants, this.floor, seat.me, seat.host, can);
  }

  /** The leader grants, hands on the lead or answers a hand; anyone raises one. Each change reaches everyone. */
  private async onGrant(ws: RoomSocket, m: GrantClient) {
    const seat = this.sockets.who(ws);
    const me = seat?.me;
    if (!me || !this.host) return;                   // named people in a sesh with a maker only
    if (m.t === "ask") {
      if (this.may(seat, m.can) || this.asks[me] === m.can) return;
      this.asks = { ...this.asks, [me]: m.can };
      this.broadcast(this.grantsMsg());
      return;
    }
    if (!this.may(seat, "lead")) return;
    const { [m.who]: asked, ...rest } = this.asks;
    let next = this.grants;
    if (m.t === "grant") next = grant(next, m.who, m.can);
    else if (m.t === "handOn") next = handOn(next, me, m.who);
    else if (asked && m.yes) {
      const had = next.who[m.who] ?? (this.floor === "free" ? (["play", "edit", "mix"] as const) : []);
      next = grant(next, m.who, [...had, asked]);
    }
    if (m.t !== "answer" || asked) this.asks = rest;
    await this.setGrants(next);
  }

  private async setGrants(g: Grants) {
    if (g !== this.grants) {
      this.grants = g;
      this.backupDirty = true;
      await this.ctx.storage.put("grants", g);
    }
    this.broadcast(this.grantsMsg());
  }

  /** `gone`: a socket on its way out, not counted in. */
  private grantsMsg(gone?: RoomSocket) {
    const here = [...new Set(this.sockets.open().flatMap((w) => { const me = w !== gone && this.sockets.who(w)?.me; return me ? [me] : []; }))];
    return { t: "grants" as const, grants: this.grants, asks: this.asks, here } satisfies GrantServer;
  }

  webSocketClose(ws: RoomSocket) { this.left(ws); }
  webSocketError(ws: RoomSocket) { this.left(ws); }

  private left(ws: RoomSocket) {
    const seat = this.sockets.who(ws);
    if (!seat?.peer) return;                         // turned away: never counted in
    this.broadcast({ t: "gone", from: seat.peer }, ws);
    // who's in changed, and a raised hand goes down with the last tab its person has in the room
    if (seat.me && this.host) {
      if (!this.sockets.open().some((w) => w !== ws && this.sockets.who(w)?.me === seat.me)) delete this.asks[seat.me];
      this.broadcast(this.grantsMsg(ws), ws);
    }
    // what they carried stays where it was; a lead they held falls out of their hand (the others drop it on "gone")
    this.studio = letGo(this.studio, seat.peer);
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
      await s.put("ladder", this.ladder);
    }
    if (this.chatDirty) {
      this.chatDirty = false;
      await s.put("chat", this.chat);
    }
    if (this.studioDirty) {
      this.studioDirty = false;
      await s.put("studio", this.studio.patch);
    }
    if (this.bucket && this.room && (this.project || this.studioUsed()) && this.backupDirty && (lastOut || Date.now() - this.backedUpAt >= BACKUP_EVERY_MS)) {
      this.backupDirty = false;
      this.backedUpAt = Date.now();
      try {
        const snaps: { at: number; project: unknown }[] = [];
        for (const at of this.ladder.snaps) { const p = await s.get(snapKey(at)); if (p) snaps.push({ at, project: p }); }
        const ladder = snaps.length ? { edited: this.ladder.edited, snaps } : undefined;
        await this.bucket.put(backupKey(this.room), JSON.stringify({ project: this.project, host: this.host, floor: this.floor, lock: this.lock || undefined, studio: this.studioUsed() ? this.studio.patch : undefined, grants: this.grants, ladder }));
      } catch { this.backupDirty = true; }
    }
    // the last one out: undo goes with them, so only the takes on tracks are kept
    if (lastOut) await this.dropTakes(takeIds(this.project));
    if (!this.idleMs || this.sockets.open().length) return;
    if (!lastOut && this.idleAt && Date.now() >= this.idleAt) {
      // nobody came back: the room goes, groove and all
      await s.deleteAlarm();
      await this.dropTakes(new Set());
      for (const k of ["project", "chat", "studio", "idleMs", "idleAt", "room", "host", "floor", "lock", "grants", "ladder", ...this.ladder.snaps.map(snapKey)]) await s.delete(k);
      this.ladder = { snaps: [], edited: 0 };
      if (this.bucket && this.room) await this.bucket.delete(backupKey(this.room)).catch(() => {});
      this.project = null;
      this.chat = empty();
      this.studio = emptyStudio();
      this.idleAt = 0;
      this.host = "";
      this.floor = "free";
      this.lock = "";
      this.grants = noGrants();
      this.asks = {};
      return;
    }
    if (!this.project && !this.studioUsed()) return; // nothing stored, nothing to clean up
    if (lastOut || !this.idleAt) {
      this.idleAt = Date.now() + this.idleMs;
      await s.put("idleMs", this.idleMs);
      await s.put("idleAt", this.idleAt);
    }
    await s.setAlarm(this.idleAt);
  }

  private save() {
    this.backupDirty = true;
    this.ladder = { ...this.ladder, edited: Date.now() };
    if (this.dirty) return;
    this.dirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private saveStudio() {
    this.backupDirty = true;
    if (this.studioDirty) return;
    this.studioDirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private saveChat() {
    if (this.chatDirty) return;
    this.chatDirty = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private broadcast(m: ServerMsg | ChatServer | StudioServer | GrantServer, except?: RoomSocket) { this.sockets.broadcast(m, except); }

  private broadcastPeers() {
    this.broadcast({ t: "peers", n: this.sockets.open().length });
  }
}
