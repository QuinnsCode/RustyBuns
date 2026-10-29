// An online match: everyone is in the same dark room, asked for the same thing, and races to
// spy it. Lobby, then a few rounds (countdown, play, round board), then a final leaderboard,
// then back to the lobby. The page does the scanning and the picking against its own copy of
// the room (the dark is each player's own); the match owns the clock, the judging of a pick
// (is it the thing asked for) and the points. Server time only: a client never says how long
// it took. It does say which object it picked, so a modified page could pick for free; for a
// party game that is the trade for not simulating splats on the server.

import { arr, bool, check, int, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import { rng } from "../levels/kit.ts";

export const MATCH = {
  countdownSecs: 5,
  roundSecs: 75,
  resultsSecs: 9,
  rounds: 3,
  /** Added to a player's time for each wrong pick. */
  wrongMs: 3000,
  /** A find faster than this is not a find. */
  minFindMs: 1200,
  maxPlayers: 8,
  /** Round points by finishing place. Not finding it scores nothing. */
  points: [100, 70, 50, 35, 25, 15, 10, 5],
};

export type Phase = "lobby" | "countdown" | "play" | "results" | "final";

const Head = obj({ t: oneOf(["start", "lobby", "pick"] as const) });
const Pick = obj({ id: int(0, 9999), shots: int(0, 99999, 0) });
export type Msg = { t: "start" } | { t: "lobby" } | { t: "pick"; id: number; shots: number };

/** A socket message from a player, checked; null when it is not one. */
export function parseMsg(raw: unknown): Msg | null {
  const h = check(Head, raw);
  if (!h) return null;
  if (h.t !== "pick") return { t: h.t };
  const p = check(Pick, raw);
  return p ? { t: "pick", id: p.id, shots: p.shots } : null;
}

const PlayerView = obj({
  id: str(32), name: str(24), online: bool(),
  /** Their time in this round with penalties, or -1 while they have not found it. */
  ms: num(-1, 1e9), shots: int(0, 99999), wrong: int(0, 999),
  /** Points this round, and so far. */
  got: int(0, 9999), total: int(0, 99999),
});
export type PlayerView = Of<typeof PlayerView>;

const ViewShape = obj({
  now: num(0, Infinity),
  phase: oneOf(["lobby", "countdown", "play", "results", "final"] as const),
  you: str(32),
  /** 0-based round, and how many there are. */
  round: int(0, 99), rounds: int(1, 99),
  /** Seeds this round's layout of the room; the same for everyone. */
  layout: int(0, 2 ** 32),
  /** Which thing to find, or -1 until the round is on. */
  target: int(-1, 9999),
  /** When the phase ends, server clock. */
  until: num(0, Infinity),
  players: arr(PlayerView, MATCH.maxPlayers),
});
export type View = Of<typeof ViewShape>;

const ServerMsgShape = obj({ t: oneOf(["view"] as const), view: ViewShape });
export type ServerMsg = Of<typeof ServerMsgShape>;
export const parseServerMsg = (raw: unknown): ServerMsg | null => check(ServerMsgShape, raw);

interface Player {
  id: string; name: string; online: boolean;
  found: { ms: number; shots: number } | null;
  wrong: number; got: number; total: number; totalMs: number;
}

export class Match {
  phase: Phase = "lobby";
  round = 0;
  /** Bumps on every change a view would show. */
  version = 0;
  players: Player[] = [];
  private targets: number[] = [];
  private layouts: number[] = [];
  private until = 0;
  private startedAt = 0;

  constructor(private things: number, private seed = Date.now()) {}

  get target() { return this.targets[this.round] ?? -1; }
  private online() { return this.players.filter((p) => p.online); }

  join(id: string, name: string): boolean {
    const have = this.players.find((p) => p.id === id);
    if (have) { have.online = true; have.name = name; this.version++; return true; }
    if (this.players.length >= MATCH.maxPlayers) return false;
    this.players.push({ id, name, online: true, found: null, wrong: 0, got: 0, total: 0, totalMs: 0 });
    this.version++;
    return true;
  }

  leave(id: string, now: number) {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    if (this.phase === "lobby") this.players = this.players.filter((q) => q !== p);
    else p.online = false;
    this.version++;
    if (!this.online().length) this.toLobby();
    else this.maybeEnd(now);
  }

  handle(id: string, m: Msg, now: number) {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    if (m.t === "start" && this.phase === "lobby") this.begin(now);
    else if (m.t === "lobby" && this.phase === "final") this.toLobby();
    else if (m.t === "pick" && this.phase === "play" && !p.found) this.pick(p, m.id, m.shots, now);
  }

  tick(now: number) {
    if (this.phase === "countdown" && now >= this.until) this.go(this.startedAt = this.until);
    else if (this.phase === "play" && now >= this.until) this.endRound(now);
    else if (this.phase === "results" && now >= this.until) {
      if (this.round + 1 < MATCH.rounds) { this.round++; this.countdown(now); }
      else { this.phase = "final"; this.version++; }
    }
  }

  private begin(now: number) {
    const r = rng(this.seed);
    const pool = Array.from({ length: this.things }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    this.targets = pool.slice(0, MATCH.rounds);
    this.layouts = this.targets.map((_, i) => (this.seed + (i + 1) * 7919) >>> 0);
    for (const p of this.players) { p.total = 0; p.totalMs = 0; p.got = 0; }
    this.players = this.players.filter((p) => p.online);
    this.round = 0;
    this.countdown(now);
  }

  private countdown(now: number) {
    for (const p of this.players) { p.found = null; p.wrong = 0; p.got = 0; }
    this.phase = "countdown";
    this.until = now + MATCH.countdownSecs * 1000;
    this.version++;
  }

  private go(now: number) {
    this.phase = "play";
    this.until = now + MATCH.roundSecs * 1000;
    this.version++;
  }

  private pick(p: Player, id: number, shots: number, now: number) {
    const elapsed = now - this.startedAt;
    if (id === this.target && elapsed >= MATCH.minFindMs) {
      p.found = { ms: elapsed + p.wrong * MATCH.wrongMs, shots };
      this.version++;
      this.maybeEnd(now);
    } else {
      p.wrong = Math.min(p.wrong + 1, 99);
      this.version++;
    }
  }

  private maybeEnd(now: number) {
    if (this.phase === "play" && this.online().every((p) => p.found)) this.endRound(now);
  }

  private endRound(now: number) {
    const order = this.players.filter((p) => p.found).sort((a, b) => a.found!.ms - b.found!.ms);
    order.forEach((p, i) => { p.got = MATCH.points[i] ?? 0; p.total += p.got; p.totalMs += p.found!.ms; });
    this.phase = "results";
    this.until = now + MATCH.resultsSecs * 1000;
    this.version++;
  }

  private toLobby() {
    this.phase = "lobby";
    this.round = 0;
    for (const p of this.players) { p.found = null; p.wrong = 0; p.got = 0; p.total = 0; p.totalMs = 0; }
    this.players = this.players.filter((p) => p.online);
    this.version++;
  }

  /** Leaderboard order: points, then the faster total time. */
  ranked(): Player[] {
    return [...this.players].sort((a, b) => b.total - a.total || a.totalMs - b.totalMs);
  }

  view(you: string, now: number): View {
    const showTarget = this.phase === "play" || this.phase === "results";
    // Lobby and final list by points; a round lists by who found it first.
    const list = this.phase === "final" || this.phase === "lobby" ? this.ranked()
      : [...this.players].sort((a, b) => (a.found?.ms ?? Infinity) - (b.found?.ms ?? Infinity) || b.total - a.total);
    return {
      now, phase: this.phase, you, round: this.round, rounds: MATCH.rounds,
      layout: this.layouts[this.round] ?? 0,
      target: showTarget ? this.target : -1,
      until: this.until,
      players: list.map((p) => ({ id: p.id, name: p.name, online: p.online, ms: p.found?.ms ?? -1, shots: p.found?.shots ?? 0, wrong: p.wrong, got: p.got, total: p.total })),
    };
  }
}
