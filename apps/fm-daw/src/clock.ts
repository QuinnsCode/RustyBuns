// The sesh's shared clock: the leader (the maker) is the master clock, like the click in a band's in-ears.
// Every other player pings the leader through the World (a few times a second at first, then every two
// seconds), keeps the answers that came back fastest, takes their median offset, and moves its own idea of the
// leader's time toward it slowly, so nothing jumps while the band plays. With no leader in, the World answers
// with its own clock. On that shared time the beat is the same everywhere: beat 0 is the leader's time 0, at the
// sesh's tempo, so a player's beat 1 lands at the same moment on every machine.
//
// Notes and sound carry the beat they were played on. Each listener picks how to hear the others: a loop late
// (the default: everyone in time, a loop behind), at the desk (the whole band a fixed delay behind, lined up;
// the leader mixing), or now (as it comes, the old way: tight when close by, ragged when far).
// No DOM, no Bun: the World, the page and the tests share it.
import { clamp } from "@rustybuns/util";
import { check, int, num, obj, oneOf, type Of } from "@rustybuns/util/guard";

const tag = <T extends string>(t: T) => oneOf([t]);
const PEER = int(1, Infinity);
/** A ping's number, so its answer is matched (it wraps). */
const N = int(0, 2 ** 31);
/** A clock reading, ms. Pages read performance.timeOrigin + performance.now(); the World reads Date.now(). */
const MS = num(0, 1e15);

/** Page to World: a player asks the leader the time (`sent` on its own clock), or the leader answers one (`at` on its). */
export const ClockClient = obj({ t: tag("tick"), n: N, sent: MS });
export const ClockAnswer = obj({ t: tag("tock"), to: PEER, n: N, sent: MS, at: MS });
export type ClockClient = Of<typeof ClockClient> | Of<typeof ClockAnswer>;
/** World to page: someone's ping, to the leader; or the answer to yours, from the leader or (none in) the World itself. */
export const ClockPing = obj({ t: tag("tick"), from: PEER, n: N, sent: MS });
export const ClockPong = obj({ t: tag("tock"), n: N, sent: MS, at: MS, by: oneOf(["leader", "world"]) });
export type ClockServer = Of<typeof ClockPing> | Of<typeof ClockPong>;
export const decodeClockClient = (v: unknown): ClockClient | null => check(ClockClient, v) ?? check(ClockAnswer, v);
export const decodeClockServer = (v: unknown): ClockServer | null => check(ClockPing, v) ?? check(ClockPong, v);

/** Whose clock this page follows: its own (it leads), the leader's, or the World's (no leader in). */
export type Source = "me" | "leader" | "world";

/** How a listener hears the others: a loop late, at the desk (a fixed delay, the band lined up), or as it comes. */
export const LISTENS = ["loop", "desk", "now"] as const;
export type Listen = (typeof LISTENS)[number];
/** The desk's delay: the worst player's latency and jitter, with room to spare. */
export const DESK_MS = 150;

/** A guitar goes out a loop late in slices this long (frames at TAKE_RATE: 100 ms), at most twice that. */
export const SOUND_FRAMES = 2400, SOUND_MAX_FRAMES = 4800;

/** Pings kept; of those, the fastest few give the offset (a slow one was stuck somewhere, one way or the other). */
export const KEEP = 16, BEST = 5;
/** Ping this often until FAST answers are in, then SLOW. */
export const FAST = 8, FAST_MS = 250, SLOW_MS = 2000;
/** How fast the offset follows the estimate once locked: 2 ms a second, a tempo change of 0.2 %, never heard. */
export const SLEW = 0.002;
/** Further off than this, it's another clock (the leader left): jump to it, playing or not. */
export const JUMP_MS = 1000;

export interface Sample { rtt: number; offset: number }
/** One ping's answer: sent and got on this page's clock, `at` on the leader's. The leader read it halfway, near enough. */
export const sampleOf = (sent: number, at: number, got: number): Sample => ({ rtt: got - sent, offset: at - (sent + got) / 2 });

/** The offset the fastest answers agree on (their median), and the fastest round trip; null with none. */
export function estimate(samples: readonly Sample[], best = BEST): { offset: number; rtt: number } | null {
  if (!samples.length) return null;
  const fast = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, best);
  const offs = fast.map((s) => s.offset).sort((a, b) => a - b), m = offs.length >> 1;
  return { offset: offs.length % 2 ? offs[m] : (offs[m - 1] + offs[m]) / 2, rtt: fast[0].rtt };
}

/** What a page knows about its clock, for `qjam.state()` and studio_state. */
export interface ClockState { source: Source | null; offset: number; target: number; rtt: number | null; samples: number; listen: Listen }

export class Clock {
  source: Source | null = null;
  /** leader time = this page's time + offset, as played: it follows `target` slowly once locked. */
  offset = 0;
  target = 0;
  rtt: number | null = null;
  listen: Listen = "loop";
  private samples: Sample[] = [];
  private locked = false;
  private stepped = NaN;
  private n = 0;
  private asked = new Map<number, number>();

  /** This page leads: its own clock is the sesh's. */
  lead() { this.reset("me"); this.locked = true; }

  /** The next ping to send, numbered, at `now`. */
  ping(now: number): { n: number; sent: number } {
    const n = (this.n = (this.n + 1) % 2 ** 31);
    this.asked.set(n, now);
    if (this.asked.size > KEEP) this.asked.delete(this.asked.keys().next().value!);
    return { n, sent: now };
  }
  /** How long until the next ping. */
  get every() { return this.samples.length < FAST ? FAST_MS : SLOW_MS; }

  /** An answer: `by` whose clock it is. One that isn't ours to match (or the leader's own page) is dropped. */
  answer(m: { n: number; sent: number; at: number; by: "leader" | "world" }, got: number) {
    if (this.source === "me" || this.asked.get(m.n) !== m.sent) return;
    this.asked.delete(m.n);
    if (m.by !== this.source) { this.samples = []; this.source = m.by; }
    this.samples.push(sampleOf(m.sent, m.at, got));
    if (this.samples.length > KEEP) this.samples.shift();
    const e = estimate(this.samples)!;
    this.target = e.offset;
    this.rtt = e.rtt;
  }

  /** Move the offset toward the estimate for the time since the last step; not playing, or far off, it jumps. */
  step(now: number, playing: boolean) {
    const dt = Number.isFinite(this.stepped) ? Math.max(0, now - this.stepped) : 0;
    this.stepped = now;
    if (this.source === "me" || !this.samples.length) return;
    const err = this.target - this.offset;
    if (!this.locked || !playing || Math.abs(err) > JUMP_MS) { this.offset = this.target; this.locked = true; return; }
    this.offset += clamp(err, -SLEW * dt, SLEW * dt);
  }

  /** The leader's time when this page's clock reads `now`. */
  leaderTime(now: number) { return now + this.offset; }
  /** The beat this page hears at `now`: the desk listens a fixed delay behind the band. */
  heard(now: number, bpm: number) { return beatAt(this.leaderTime(now) - (this.listen === "desk" ? DESK_MS : 0), bpm); }

  state(): ClockState {
    return { source: this.source, offset: round(this.offset), target: round(this.target), rtt: this.rtt === null ? null : round(this.rtt), samples: this.samples.length, listen: this.listen };
  }

  private reset(source: Source | null) { this.source = source; this.samples = []; this.offset = this.target = 0; this.rtt = null; this.locked = false; this.asked.clear(); }
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The beat at a time on the leader's clock: beat 0 is the leader's time 0, so every machine counts the same beats. */
export const beatAt = (leaderMs: number, bpm: number) => (leaderMs * bpm) / 60000;

/** The audio thread's beat at context time `now` (s), from the page's last word: context time `ctx` is heard on `beat`. */
export const gridBeatAt = (beat: number, ctx: number, now: number, bpm: number) => beat + ((now - ctx) * bpm) / 60;

/**
 * The beat a note or a chunk of sound stamped `b` sounds on here, on this listener's own beat count, or null for
 * as it comes. A loop late: the same place in the next loop. At the desk the listener's beat count already runs
 * the delay behind, so it plays on its stamp.
 */
export function playAt(b: number, listen: Listen, loopBeats: number): number | null {
  return listen === "loop" ? b + loopBeats : listen === "desk" ? b : null;
}
