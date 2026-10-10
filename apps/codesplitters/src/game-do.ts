// One Durable Object per game room: a level ("l/mitt") or a repo ("r/ana/dig").
// It is the lobby people wait in on that page, and the relay once the round
// starts. Each player swats the lines in their own room of the backrooms; the
// room only carries where everyone is, who bopped whom, and the scores.
//
// A round is one of three modes, picked in the lobby by anyone while it waits:
//   horde    the lines come off the walls at you (the default)
//   wreck    a panic room: everyone smashes the codebase's walls and furniture together
//   removed  smash the lines a diff took out of one file, as furniture; `diff` says which
// In wreck and removed the room keeps what's been broken this round, so everyone
// (and anyone walking in late) sees the same wreckage.
//
// Socket messages, client -> room:
//   {t:"mode", mode, diff?}          pick the mode (and for removed, {path, from, to}) while waiting
//   {t:"break", id}                  you broke a piece; relayed, and kept for the round
//   {t:"ready"}                      ready up; the round starts when everyone is
//   {t:"start"}                      start now with whoever is here; mid-round, only
//                                    once everyone still "alive" has gone quiet
//   {t:"pos", p:[x,y,z], yaw, room, swing}   ~10 a second, relayed to the others
//   {t:"hit", target, dir:[x,z]}     you bopped someone (with a rolled-up README)
//   {t:"score", score, wave}         your running score
//   {t:"dead"}                       out; when everyone is, the round is over
// room -> client:
//   {t:"lobby", you, state, mode, diff?, players:[{id,user,ready,alive,score,wave}], seed?, startAt?, broken?}
//   {t:"start", seed, startAt, mode, diff?}  {t:"broke", id, by}  {t:"pos", id, ...}  {t:"bopped", by, dir}  {t:"over", players}
//   {t:"note", text}                 why a start or ready did nothing
// Players live on their sockets (attachments survive hibernation); the stored keys are the round and the setup.

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

interface Player { id: string; user: string; ready: boolean; alive: boolean; score: number; wave: number; seen: number }
type Mode = "horde" | "wreck" | "removed";
interface Diff { path: string; from: number; to: number }
interface Setup { mode: Mode; diff?: Diff }
interface Round { state: "waiting" | "playing"; seed?: number; startAt?: number; mode?: Mode; diff?: Diff; broken?: string[] }
const MODES: Mode[] = ["horde", "wreck", "removed"];
/** A diff from a socket: a path and two revs, or nothing. */
const asDiff = (d: any): Diff | undefined =>
  d && typeof d.path === "string" && d.path.length < 512 && Number.isInteger(d.from) && Number.isInteger(d.to) && d.from >= 0 && d.to > d.from
    ? { path: d.path, from: d.from, to: d.to } : undefined;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const MAX_PLAYERS = 8, MAX_BROKEN = 5000;

export class GameRoom {
  /** A player alive in a round who hasn't moved for this long (a background tab, a dropped
   *  laptop) no longer holds the round open. */
  static IDLE_MS = 20_000;
  constructor(private ctx: any, _env: unknown) {}

  sockets(): any[] { return this.ctx.getWebSockets(); }
  me(ws: any): Player { return ws.deserializeAttachment() as Player; }
  save(ws: any, p: Player) { ws.serializeAttachment(p); }

  /** Whether a round is on, and its seed. */
  async round(): Promise<Round> { return ((await this.ctx.storage.get("round")) as Round) ?? { state: "waiting" }; }
  async setRound(r: Round) { await this.ctx.storage.put("round", r); }
  /** The mode the next round will be. */
  async setup(): Promise<Setup> { return ((await this.ctx.storage.get("setup")) as Setup) ?? { mode: "horde" }; }

  async fetch(req: Request): Promise<Response> {
    const user = req.headers.get("x-codesplitters-user") ?? "guest";
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      const r = await this.round();
      return json({ state: r.state, players: this.sockets().map((ws) => this.me(ws).user) });
    }
    if (this.sockets().length >= MAX_PLAYERS) return json({ error: "room is full" }, 429);
    const [client, server] = Object.values(new WebSocketPair()) as [unknown, any];
    this.ctx.acceptWebSocket(server);
    const r = await this.round();
    // Joining a round in progress: you're in it, from wave 1.
    this.save(server, { id: crypto.randomUUID().slice(0, 8), user, ready: false, alive: true, score: 0, wave: 0, seen: Date.now() });
    await this.lobby(r);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async lobby(r?: Round) {
    return this.lobbyExcept(undefined, r);
  }
  /** What the lobby says about the mode: the round's while one is on, else the next one's. */
  async modeOf(r: Round) {
    if (r.state === "playing") return { mode: r.mode ?? "horde", diff: r.diff, broken: r.broken ?? [] };
    const s = await this.setup();
    return { mode: s.mode, diff: s.diff };
  }

  send(ws: any, msg: unknown) { try { ws.send(JSON.stringify(msg)); } catch {} }
  others(ws: any, msg: unknown) { for (const o of this.sockets()) if (o !== ws) this.send(o, msg); }

  async start() {
    const s = await this.setup();
    const r: Round = { state: "playing", seed: Math.floor(Math.random() * 2 ** 31), startAt: Date.now() + 3000, mode: s.mode, diff: s.diff, broken: [] };
    for (const ws of this.sockets()) this.save(ws, { ...this.me(ws), ready: false, alive: true, score: 0, wave: 0, seen: Date.now() });
    await this.setRound(r);
    for (const ws of this.sockets()) this.send(ws, { t: "start", seed: r.seed, startAt: r.startAt, mode: r.mode, diff: r.diff });
    await this.lobby(r);
  }

  async webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    let m: any;
    try { m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const p = this.me(ws);
    if (m.t === "pos") {
      if (Date.now() - (p.seen ?? 0) > 2000) this.save(ws, { ...p, seen: Date.now() });
      return this.others(ws, { t: "pos", id: p.id, user: p.user, p: m.p, yaw: m.yaw, room: m.room, swing: !!m.swing });
    }
    if (m.t === "hit" && typeof m.target === "string") {
      const target = this.sockets().find((o) => this.me(o).id === m.target);
      if (target) this.send(target, { t: "bopped", by: p.user, dir: m.dir });
      return;
    }
    const r = await this.round();
    if (m.t === "break" && typeof m.id === "string" && m.id.length <= 200 && r.state === "playing" && r.mode !== "horde") {
      const broken = r.broken ?? [];
      if (broken.includes(m.id) || broken.length >= MAX_BROKEN) return;
      broken.push(m.id);
      await this.setRound({ ...r, broken });
      this.save(ws, { ...p, seen: Date.now() });
      return this.others(ws, { t: "broke", id: m.id, by: p.user });
    }
    if (m.t === "mode") {
      if (r.state === "playing") return this.send(ws, { t: "note", text: "The mode changes between rounds." });
      if (!MODES.includes(m.mode)) return;
      const diff = asDiff(m.diff);
      if (m.mode === "removed" && !diff) return this.send(ws, { t: "note", text: "Pick a diff first: a file's History, or one of its commits." });
      await this.ctx.storage.put("setup", { mode: m.mode, diff: diff ?? (await this.setup()).diff } satisfies Setup);
      return this.lobby(r);
    }
    if ((m.t === "ready" || m.t === "start") && r.state === "playing") {
      // Out, and the round is still on. Players who went quiet don't count as still on.
      const still = this.sockets().map((o) => this.me(o)).filter((x) => x.alive && Date.now() - (x.seen ?? 0) <= GameRoom.IDLE_MS);
      if (still.length === 0) return this.start();
      return this.send(ws, { t: "note", text: `Round still on: ${still.map((x) => x.user).join(", ")} playing. Start again when they're out.` });
    }
    if (m.t === "ready" && r.state === "waiting") {
      this.save(ws, { ...p, ready: !p.ready });
      const all = this.sockets().map((o) => this.me(o));
      return all.every((x) => x.ready) ? this.start() : this.lobby(r);
    }
    if (m.t === "start" && r.state === "waiting") return this.start();
    if (m.t === "score") {
      this.save(ws, { ...p, score: Number(m.score) || 0, wave: Number(m.wave) || 0, seen: Date.now() });
      return this.lobby(r);
    }
    if (m.t === "dead") {
      this.save(ws, { ...p, alive: false, score: Number(m.score ?? p.score) || 0 });
      return this.maybeOver(r);
    }
  }

  async maybeOver(r: Round, leaving?: any) {
    const left = this.sockets().filter((o) => o !== leaving);
    if (r.state === "playing" && left.every((o) => !this.me(o).alive)) {
      const players = left.map((o) => this.me(o));
      await this.setRound({ state: "waiting" });
      for (const o of left) this.send(o, { t: "over", players });
      return this.lobbyExcept(leaving);
    }
    return this.lobbyExcept(leaving);
  }

  async lobbyExcept(leaving?: any, r?: Round) {
    r ??= await this.round();
    const live = this.sockets().filter((o) => o !== leaving);
    const players = live.map((o) => this.me(o)), mode = await this.modeOf(r);
    for (const ws of live) this.send(ws, { t: "lobby", you: this.me(ws).id, state: r.state, ...mode, players, seed: r.seed, startAt: r.startAt });
  }

  async webSocketClose(ws: any) { try { ws.close(); } catch {} await this.gone(ws); }
  async webSocketError(ws: any) { await this.gone(ws); }
  async gone(ws: any) {
    const r = await this.round();
    if (this.sockets().filter((o) => o !== ws).length === 0) return this.setRound({ state: "waiting" });
    return this.maybeOver(r, ws);
  }
}
