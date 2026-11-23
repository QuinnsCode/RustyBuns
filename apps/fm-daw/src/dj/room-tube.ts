// The room hears a YouTube deck. Its sound stays inside YouTube's player on the DJ's page, so the PA can't carry it;
// instead the deck says its video, where it is, its speed and its channel's volume on the booth's line (booth.ts,
// `tube` and `vol` on a `deck` say), and each listener's page plays the same video in a hidden player of its own:
// kept on the room's shared clock (a seek when it drifts more than DRIFT_S, then SETTLE_MS for it to buffer), at the
// DJ's speed, and at their volume times how loud the PA is where they stand (pa-room.ts `roomLevel`).
// A browser that hasn't been pressed yet won't play sound, and one that blocks YouTube never loads the player: either
// way `note()` says so, with what's playing, for the page to show. `tubeStep` is pure, for the test; `RoomTubes` keeps the players.
import { posAt, type DeckSay, type Theirs } from "./booth.ts";
import { TubeDeck } from "./youtube.ts";

/** How far a listener's video may drift from the DJ's before it seeks, seconds: about a beat's swing, and YouTube's seeks aren't finer. */
export const DRIFT_S = 0.35;
/** A seek lands this far ahead (at speed 1), seconds: YouTube takes about that long to play from a new spot. */
export const SEEK_LEAD_S = 0.25;
/** After a seek, the player gets this long to fill up and play before it's checked again, ms. */
export const SETTLE_MS = 2000;
/** A player asked to play that still isn't moving after this long needs a press from its listener, ms. */
export const STUCK_MS = 3000;

/** What a listener's player does now to follow the DJ's deck: play or pause, a seek (or null), its speed and volume (0 to 100). */
export interface Step { play: boolean; seek: number | null; rate: number; volume: number }

/** A listener's player against the said deck at `now` on the room's clock: `p` where it is, `sinceSeek` ms since it last jumped, `level` the PA's where they stand. */
export function tubeStep(say: DeckSay, now: number, p: { pos: number; moving: boolean }, sinceSeek: number, level: number): Step {
  const want = posAt(say, now), drift = p.pos - want;
  const volume = Math.round(Math.min(100, Math.max(0, (say.vol ?? 100) * level)));
  // playing, it may swing DRIFT_S; stopped (or not yet moving), it waits on the very spot the DJ's is
  const off = Math.abs(drift) > (say.playing && p.moving ? DRIFT_S : 0.05);
  const seek = off && sinceSeek >= SETTLE_MS ? (say.playing ? Math.min(say.len, want + SEEK_LEAD_S * say.rate) : want) : null;
  return { play: say.playing, seek, rate: say.rate, volume };
}

interface Follow { id: string; owner: number; deck: TubeDeck; host: HTMLElement; seekAt: number; askedAt: number; blocked: string | null; title: string }

/** The hidden players on a listener's page, one a deck, following the YouTube decks other people play. */
export class RoomTubes {
  private follows: [Follow | null, Follow | null] = [null, null];

  constructor(private parent: HTMLElement = document.body) {}

  /** Each frame: the booth's decks (`sides`, someone else's), the room's clock `now`, and the PA's level where you stand for each owner (0: muted). */
  follow(sides: readonly (Theirs | null)[], now: number, level: (owner: number) => number, wall = performance.now()) {
    for (const side of [0, 1] as const) {
      const t = sides[side] ?? null, id = t?.say.tube;
      let f = this.follows[side];
      if (f && (!t || !id || f.id !== id || f.owner !== t.owner)) { this.drop(side); f = null; }
      if (!t || !id) continue;
      f ??= this.make(side, id, t.owner);
      f.title = t.say.name ?? "YouTube";
      const deck = f.deck;
      if (f.blocked || !deck.isReady()) continue;
      if (deck.failed) { f.blocked = deck.failed; deck.pause(); continue; }
      const step = tubeStep(t.say, now, { pos: deck.pos(), moving: deck.moving }, wall - f.seekAt, level(t.owner));
      deck.follow(step.rate, step.volume);
      if (step.seek !== null) { deck.seek(step.seek); f.seekAt = wall; }
      if (step.play && !deck.moving && this.mayPlay() && wall - f.askedAt > SETTLE_MS) { deck.play(); f.askedAt = wall; }
      if (!step.play && deck.moving) deck.pause();
    }
  }

  /** What the listener should be told, or null: YouTube blocked here, or a press needed before the browser lets it sound. */
  note(wall = performance.now()): string | null {
    for (const [side, f] of this.follows.entries()) {
      if (!f) continue;
      const on = `${f.title} on deck ${side ? "B" : "A"}`;
      if (f.blocked) return `You can't hear ${on}: ${f.blocked}`;
      if (!f.deck.isReady() || f.deck.moving) continue;
      if (!this.mayPlay() || (f.askedAt && wall - f.askedAt > STUCK_MS)) return `Press anywhere to hear ${on} (YouTube)`;
    }
    return null;
  }

  /** A press on the page: the browser lets sound play now, so a stuck player tries again. */
  pressed() { for (const f of this.follows) if (f) f.askedAt = 0; }

  /** Each deck's follower, for the harness. */
  state() {
    return this.follows.map((f) => (f ? { id: f.id, title: f.title, ready: f.deck.isReady(), moving: f.deck.moving, pos: +f.deck.pos().toFixed(2), blocked: f.blocked } : null));
  }

  private mayPlay() { return !navigator.userActivation || navigator.userActivation.hasBeenActive; }

  private make(side: 0 | 1, id: string, owner: number): Follow {
    // off screen, not display:none: a player that isn't laid out may not play
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none;opacity:0";
    this.parent.append(host);
    const deck = new TubeDeck(id, host);
    const f: Follow = { id, owner, deck, host, seekAt: -Infinity, askedAt: 0, blocked: null, title: "YouTube" };
    deck.ready.catch((e: unknown) => { f.blocked = e instanceof Error ? e.message : "YouTube's player didn't load"; });
    this.follows[side] = f;
    return f;
  }

  private drop(side: 0 | 1) {
    const f = this.follows[side];
    if (!f) return;
    f.deck.destroy(); f.host.remove();
    this.follows[side] = null;
  }

  destroy() { this.drop(0); this.drop(1); }
}
