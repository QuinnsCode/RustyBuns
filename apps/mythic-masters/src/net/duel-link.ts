// The page's side of a duel (net/duel.ts): the socket to the room, the round's lockstep, and what to send after each frame.
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { fresh, login } from "../account.ts";
import { uid } from "./online.ts";
import type { Match } from "../sim.ts";
import { decodeDuel, delayFor, Lockstep, SUM_EVERY, sum, type DuelIn, type DuelOut, type Pick } from "./duel.ts";

export type DuelStatus = "joining" | "in" | "offline" | "full" | "signin";
export interface DuelOpts {
  /** ws(s)://host, for a page or test not on the Worker's own origin. */
  base?: string;
  /** Join as a guest with this uid (only where the Worker lets guests in: dev and tests). */
  guest?: { uid: string; name: string };
  onSeats?(s: Extract<DuelOut, { t: "seats" }>): void;
  onGo?(g: Extract<DuelOut, { t: "go" }>, delay: number): void;
  onDesync?(): void;
  onStatus?(s: DuelStatus): void;
}
/** The room's close codes (edge/duel.ts). */
const CLOSE = { full: 4003, signIn: 4401, replaced: 4001 };

export class DuelLink {
  status: DuelStatus = "joining";
  seats: Extract<DuelOut, { t: "seats" }> | null = null;
  step: Lockstep | null = null;
  private link: Link<DuelIn>;
  private rtt: number[] = [];
  private summed = 0;

  constructor(readonly code: string, private readonly o: DuelOpts = {}) {
    const base = o.base ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    const who = (): Record<string, string> => {
      if (o.guest) return { uid: o.guest.uid, name: o.guest.name };
      const l = login();
      // Signed out, the uid this browser made: only a local edge lets that in (the live one closes with "sign in").
      return l && fresh(l) ? { token: l.token } : { uid: uid() };
    };
    this.link = connectSocket<DuelOut, DuelIn>(() => `${base}/duel?${new URLSearchParams({ room: code, ...who() })}`, {
      decode: decodeDuel,
      queue: 4, // a pick made before the socket is open
      onOpen: () => { this.set("in"); for (const ms of [0, 250, 600]) setTimeout(() => this.link.send({ e: "echo", at: Math.round(performance.now()) }), ms); },
      onMessage: (m) => this.hear(m),
      onClose: (e) => {
        // A dropped link drops the round: lockstep can't pick up a fight half the inputs of which went nowhere.
        this.step = null;
        if (e.code === CLOSE.full) { this.set("full"); return null; }
        if (e.code === CLOSE.signIn) { this.set("signin"); return null; }
        if (e.code === CLOSE.replaced) { this.set("offline"); return null; }
        this.set("offline");
        return 1000 * Math.min(8, 2 ** (e.tries - 1));
      },
    });
  }

  private set(s: DuelStatus) { this.status = s; this.o.onStatus?.(s); }

  private hear(m: DuelOut) {
    if (m.t === "echo") { this.rtt.push(performance.now() - m.at); return; }
    if (m.t === "seats") { this.seats = m; this.o.onSeats?.(m); return; }
    if (m.t === "go") {
      this.wanted = null; clearInterval(this.asking);
      const delay = delayFor(this.rtt.length ? Math.min(...this.rtt) : 100);
      this.step = new Lockstep(this.seats?.you ?? 0, m.r, delay);
      this.o.onGo?.(m, delay);
      return;
    }
    if (m.t === "in") { if (this.step?.r === m.r) this.step.hear(m.n, m.i); return; }
    if (m.t === "from") { if (this.step?.r === m.r) this.step.resend(m.n); return; }
    if (this.step?.r === m.r) { this.step = null; this.o.onDesync?.(); }
  }

  /** Who we fight with next. Said again each second until the room shows it (a busy room may drop one), and after a reconnect. */
  pick(p: Pick) {
    this.wanted = p;
    this.link.send({ e: "pick", ...p });
    clearInterval(this.asking);
    this.asking = setInterval(() => { if (this.wanted && this.link.open && !this.seats?.picked[this.seats.you]) this.link.send({ e: "pick", ...this.wanted }); }, 1000);
  }
  private wanted: Pick | null = null;
  private asking: ReturnType<typeof setInterval> | undefined;

  /** After a frame's ticks: what we owe the room, and a fight hash on the SUM_EVERY ticks. */
  flush(m: Match | null) {
    const s = this.step;
    if (!s) return;
    for (const b of s.outbox()) this.link.send({ e: "in", r: s.r, ...b });
    if (m && m.tick % SUM_EVERY === 0 && m.tick > 0 && this.summed !== m.tick) { this.summed = m.tick; this.link.send({ e: "sum", r: s.r, n: m.tick, h: sum(m) }); }
  }
  close() { this.step = null; this.wanted = null; clearInterval(this.asking); this.link.close(); }
}
