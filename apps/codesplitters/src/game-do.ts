// One Durable Object per game room: a level ("l/mitt") or a repo ("r/ana/dig").
// It is the lobby people wait in on that page, and the relay once the round
// starts. Each player fights the lines in their own room of the backrooms; the
// room only carries where everyone is, who clubbed whom, and the scores.
//
// Socket messages, client -> room:
//   {t:"ready"}                      ready up; the round starts when everyone is
//   {t:"start"}                      start now with whoever is here; mid-round, only
//                                    once everyone still "alive" has gone quiet
//   {t:"pos", p:[x,y,z], yaw, room, swing}   ~10 a second, relayed to the others
//   {t:"hit", target, dir:[x,z]}     you clubbed someone
//   {t:"score", score, wave}         your running score
//   {t:"dead"}                       out; when everyone is, the round is over
// room -> client:
//   {t:"lobby", you, state, players:[{id,user,ready,alive,score,wave}], seed?, startAt?}
//   {t:"start", seed, startAt}  {t:"pos", id, ...}  {t:"clubbed", by, dir}  {t:"over", players}
//   {t:"note", text}                 why a start or ready did nothing
// Players live on their sockets (attachments survive hibernation); the only stored key is the round.

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

interface Player { id: string; user: string; ready: boolean; alive: boolean; score: number; wave: number; seen: number }
interface Round { state: "waiting" | "playing"; seed?: number; startAt?: number }

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const MAX_PLAYERS = 8;

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
    r ??= await this.round();
    const players = this.sockets().map((ws) => this.me(ws));
    for (const ws of this.sockets()) this.send(ws, { t: "lobby", you: this.me(ws).id, state: r.state, players, seed: r.seed, startAt: r.startAt });
  }

  send(ws: any, msg: unknown) { try { ws.send(JSON.stringify(msg)); } catch {} }
  others(ws: any, msg: unknown) { for (const o of this.sockets()) if (o !== ws) this.send(o, msg); }

  async start() {
    const r: Round = { state: "playing", seed: Math.floor(Math.random() * 2 ** 31), startAt: Date.now() + 3000 };
    for (const ws of this.sockets()) this.save(ws, { ...this.me(ws), ready: false, alive: true, score: 0, wave: 0, seen: Date.now() });
    await this.setRound(r);
    for (const ws of this.sockets()) this.send(ws, { t: "start", seed: r.seed, startAt: r.startAt });
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
      if (target) this.send(target, { t: "clubbed", by: p.user, dir: m.dir });
      return;
    }
    const r = await this.round();
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

  async lobbyExcept(leaving?: any) {
    const r = await this.round();
    const live = this.sockets().filter((o) => o !== leaving);
    const players = live.map((o) => this.me(o));
    for (const ws of live) this.send(ws, { t: "lobby", you: this.me(ws).id, state: r.state, players, seed: r.seed, startAt: r.startAt });
  }

  async webSocketClose(ws: any) { try { ws.close(); } catch {} await this.gone(ws); }
  async webSocketError(ws: any) { await this.gone(ws); }
  async gone(ws: any) {
    const r = await this.round();
    if (this.sockets().filter((o) => o !== ws).length === 0) return this.setRound({ state: "waiting" });
    return this.maybeOver(r, ws);
  }
}
