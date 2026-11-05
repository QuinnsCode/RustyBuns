// The page's side of walking together (#3663): one socket to the room for the region you stand in, swapped when you
// cross a border. `tick` runs every frame but only sends on a SEND_MS beat, and only when your quantised pose changed
// (plus once more when you stop, so the others see you stand still rather than drift on). Friends are drawn DELAY
// behind their newest pose, between two poses, so 5 a second walks as smoothly as 60; past the newest pose they carry
// on along their last heading for at most a beat, then wait. Offline or dropped, nothing breaks: the friends go, the
// world's clock runs on from the last offset, and the socket tries again on its own. No DOM, so a bot runs it too.
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { down, fromH, PERIOD, Q, SEND_MS, toH, CLOSE_REPLACED, CLOSE_FULL, type Up, type Walker } from "./wire.ts";

/** How far behind their newest pose friends are drawn: a beat and a half, so a late pose still has one to walk to. */
export const DELAY = SEND_MS * 1.5;
/** How long past its newest pose a friend carries on (dead reckoning) before it waits for the next. */
export const COAST = SEND_MS;

export interface Pose { x: number; z: number; yaw: number }
export interface Friend extends Pose { s: number; name: string; lead: string }

interface Sample { at: number; x: number; z: number; yaw: number }
const turn = (a: number, b: number, k: number) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * k; };

/** Where a friend is drawn at `now` from its poses, oldest first: between the two either side of `now - DELAY`,
 * or on along the last two's way for at most COAST past the newest. */
export function poseAt(track: readonly Sample[], now: number): Pose | null {
  const t = now - DELAY, last = track.at(-1);
  if (!last) return null;
  for (let i = track.length - 1; i > 0; i--) {
    const a = track[i - 1]!, b = track[i]!;
    if (a.at <= t && t <= b.at) { const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: turn(a.yaw, b.yaw, k) }; }
  }
  const prev = track.at(-2);
  if (t <= last.at || !prev || last.at <= prev.at) return t < (track[0]?.at ?? 0) ? { ...track[0]! } : { x: last.x, z: last.z, yaw: last.yaw };
  const k = Math.min(t - last.at, COAST) / (last.at - prev.at);
  return { x: last.x + (last.x - prev.x) * k, z: last.z + (last.z - prev.z) * k, yaw: last.yaw };
}

export interface TogetherOpts {
  /** The socket's address for a region, with a fresh token: called on every try. */
  url(region: number): string;
  /** Where you stand now, and in which region; null while not walking (a fight, the title). */
  me(): (Pose & { region: number }) | null;
  /** Your line-up's lead. */
  lead(): string;
  /** A den someone else in the room walked into: quiet it here too. */
  onCalm?(den: string, by: string): void;
  /** The room said you were opened in another tab, or something else that won't mend by trying again. */
  onGone?(why: string): void;
}

export function together(o: TogetherOpts) {
  let link: Link<Up> | null = null, region = 0, you = -1, offset: number | null = null;
  let walkers: Walker[] = [];
  const tracks = new Map<number, Sample[]>();
  let lastSent: number[] | null = null, still = true, nextAt = 0, leadSent = "";
  const n = { sent: 0, got: 0, bytesIn: 0, bytesOut: 0 };

  function open(r: number) {
    link?.close();
    region = r; you = -1; walkers = []; tracks.clear(); lastSent = null; leadSent = "";
    link = connectSocket(() => o.url(r), {
      decode: (v) => { const m = down(v); if (m) { n.got++; n.bytesIn += JSON.stringify(v).length; } return m; },
      encode: (m) => { const s = JSON.stringify(m); n.sent++; n.bytesOut += s.length; return s; },
      onMessage: (m) => {
        const now = performance.now();
        if (m.t === "hi") { you = m.you; offset = m.now - Date.now(); for (const d of m.calm) o.onCalm?.(d, ""); }
        else if (m.t === "who") {
          const had = new Set(walkers.map((w) => w.s));
          walkers = m.walkers;
          for (const s of tracks.keys()) if (!walkers.some((w) => w.s === s)) tracks.delete(s);
          // someone new: send where you stand even if you stand still, so they see you
          if (walkers.some((w) => !had.has(w.s) && w.s !== you)) lastSent = null;
        } else if (m.t === "v") {
          for (const [s, x, z, h] of m.p) {
            if (s === you) continue;
            const t = tracks.get(s!) ?? [];
            t.push({ at: now, x: x! / Q, z: z! / Q, yaw: fromH(h!) });
            if (t.length > 4) t.shift();
            tracks.set(s!, t);
          }
        } else if (m.t === "calm") o.onCalm?.(m.den, walkers.find((w) => w.s === m.s)?.name ?? "");
      },
      onClose: (e) => {
        walkers = []; tracks.clear(); you = -1;
        if (e.code === CLOSE_REPLACED) { o.onGone?.("Walking with the party in another tab."); return null; }
        if (e.code === CLOSE_FULL) return 30_000;
        return Math.min(15_000, 1000 * 2 ** Math.min(4, e.tries - 1));
      },
    });
  }

  return {
    /** Every frame: follow your region, and on a beat send your pose if it changed (or once more as you stop). */
    tick(now = performance.now()) {
      const me = o.me();
      if (!me) return;
      if (me.region !== region) open(me.region);
      if (now < nextAt || !link?.open || you < 0) return;
      nextAt = now + SEND_MS;
      const lead = o.lead();
      if (lead && lead !== leadSent) { leadSent = lead; link.send({ t: "lead", id: lead }); }
      const p = [Math.round(me.x * Q), Math.round(me.z * Q), toH(me.yaw)];
      const same = lastSent !== null && p.every((v, i) => v === lastSent![i]);
      if (same && still) return;
      still = same;
      lastSent = p;
      link.send({ t: "p", x: p[0]!, z: p[1]!, h: p[2]! });
    },
    /** Everyone else in your room, where they are drawn now. */
    friends(now = performance.now()): Friend[] {
      const out: Friend[] = [];
      for (const w of walkers) {
        if (w.s === you) continue;
        const p = poseAt(tracks.get(w.s) ?? [], now);
        if (p) out.push({ ...w, ...p });
      }
      return out;
    },
    /** The world's clock, seconds, the room's for everyone in it; null before any room answered. */
    clock(): number | null { return offset === null ? null : (((Date.now() + offset) / 1000) % PERIOD + PERIOD) % PERIOD; },
    /** You walked into den `den`: it goes quiet for the rest of the room. */
    calm(den: string) { link?.send({ t: "calm", den }); },
    state: () => ({ open: !!link?.open, region, you, walkers: walkers.map((w) => ({ ...w })), ...n }),
    close() { link?.close(); link = null; region = 0; walkers = []; tracks.clear(); },
  };
}
export type Together = ReturnType<typeof together>;
