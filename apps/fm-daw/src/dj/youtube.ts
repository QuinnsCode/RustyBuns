// A YouTube video on a deck: paste a link in the library and send it to A or B. The video plays in YouTube's own
// player on the deck (its sound never reaches this page: the browser keeps another site's audio to itself), so the
// deck drives the player instead: play, the cue, hot cues, jumps and the overview's seek move it, the pitch fader sets
// its speed (YouTube rounds to the speeds it offers), and the deck's channel fader, trim, crossfader and master set its
// volume. The EQ, the filters, the scratch and the room's PA can't reach it. In a room the deck says its video, where
// it is and its speed on the booth's line (booth.ts), and each listener's page plays the same video (room-tube.ts).
// Nothing is hosted here.
import { arr, check, obj, str, type Of } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { faderGain } from "./analyze.ts";
import { dbGain, trimDb, xfGain, type ChannelState, type Curve } from "./mixer.ts";
import type { DeckView, Press } from "./booth.ts";
import { hotOf } from "./booth.ts";

/** A video's id from what someone pasted: a watch, short, live, embed or youtu.be link, or the bare 11-character id. */
export function videoId(pasted: string): string | null {
  const t = pasted.trim(), ok = (s: string | null | undefined) => (s && /^[\w-]{11}$/.test(s) ? s : null);
  if (ok(t)) return t;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return ok(u.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  return ok(u.searchParams.get("v")) ?? ok(u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1]);
}

/** The volume (0 to 100) a deck's channel gives its YouTube player: fader, trim, crossfader and master, 100 at the defaults. */
export function tubeVolume(ch: ChannelState, xfader: number, curve: Curve, master: number): number {
  const g = faderGain(ch.fader) * dbGain(trimDb(ch.trim)) * xfGain(ch.xf, xfader, curve) * faderGain(master);
  const ref = faderGain(0.8) * faderGain(0.8) * xfGain("x", 0, "smooth");
  return Math.round(Math.min(1, g / ref) * 100);
}

/** YouTube's oEmbed reply: the one field the deck shows. */
const OEmbed = obj({ title: str(300) });
/** A video's title, from YouTube's oEmbed (null offline or when it's private). */
export const tubeTitle = async (id: string) => (await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, OEmbed))?.title ?? null;

/** The most YouTube links the library keeps. */
export const SHELF_MAX = 200;
/** A YouTube link in the library: its video id and the title YouTube gave it. Only links, kept in this browser. */
const Shelved = obj({ id: str(11), title: str(300) });
export type Shelved = Of<typeof Shelved>;
const ShelfList = arr(Shelved, SHELF_MAX, { drop: true });
const SHELF_KEY = "qdjs:youtube";
/** The YouTube links this browser's library keeps, newest first (none in a private window). */
export function loadShelf(): Shelved[] {
  try { const s = localStorage.getItem(SHELF_KEY); return (s && check(ShelfList, JSON.parse(s))) || []; } catch { return []; }
}
export function saveShelf(list: readonly Shelved[]) { try { localStorage.setItem(SHELF_KEY, JSON.stringify(list.slice(0, SHELF_MAX))); } catch { /* private window: this visit only */ } }
/** `item` at the top of the library, once (a link added again moves up, keeping the title it had when `item` has none better). */
export function shelveTube(list: readonly Shelved[], item: Shelved): Shelved[] {
  const had = list.find((x) => x.id === item.id);
  const title = item.title === "YouTube" && had ? had.title : item.title;
  return [{ id: item.id, title }, ...list.filter((x) => x.id !== item.id)].slice(0, SHELF_MAX);
}

/** The part of YouTube's IFrame player the deck uses (https://developers.google.com/youtube/iframe_api_reference). */
interface YtPlayer {
  playVideo(): void; pauseVideo(): void; seekTo(s: number, allowAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number;
  setVolume(v: number): void; setPlaybackRate(r: number): void; getPlaybackRate(): number; loadVideoById(id: string): void; destroy(): void;
}
interface YtEvent { data: number; target: YtPlayer }
declare global {
  interface Window {
    YT?: { Player: new (host: HTMLElement, o: { videoId: string; width?: string; height?: string; playerVars?: Record<string, number>; events?: { onReady?: (e: YtEvent) => void; onStateChange?: (e: YtEvent) => void; onError?: (e: YtEvent) => void } }) => YtPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}
const PLAYING = 1, BUFFERING = 3;
const NO_WAVE = new Float32Array(0);
let api: Promise<void> | null = null;
/** YouTube's player script, added once. */
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  api ??= new Promise((ok, fail) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { before?.(); ok(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { api = null; fail(new Error("YouTube's player didn't load (offline, or blocked)")); };
    document.head.append(s);
  });
  return api;
}

/** One deck's YouTube player, in `host` (the deck's video box). */
export class TubeDeck {
  /** The player once YouTube says it is ready (its methods come then); `made` from the start, to take it down. */
  private player: YtPlayer | null = null;
  private made: YtPlayer | null = null;
  readonly ready: Promise<void>;
  cue = 0;
  hot: (number | null)[] = [null, null, null, null];
  /** Held cue: playing from the mark until it's let go. */
  cueHeld = false;
  title: string;
  private shownRate = 1;
  private shownVol = -1;
  private playing = false;
  /** What YouTube's player last said it is doing: playing or filling up to play (not what was asked of it). */
  moving = false;
  /** Why YouTube's player gave up on the video, or null. */
  failed: string | null = null;

  constructor(readonly id: string, host: HTMLElement, title = "YouTube") {
    this.title = title;
    const box = document.createElement("div");
    host.replaceChildren(box);
    this.ready = loadApi().then(() => new Promise<void>((ok, fail) => {
      const YT = window.YT;
      if (!YT) return fail(new Error("YouTube's player didn't load"));
      this.made = new YT.Player(box, {
        videoId: id, width: "100%", height: "100%",
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, fs: 0 },
        events: { onReady: (e) => { if (this.made) { this.player = e.target; ok(); } }, onStateChange: (e) => { this.playing = e.data === PLAYING; this.moving = e.data === PLAYING || e.data === BUFFERING; },
          onError: (e) => { this.failed = e.data === 101 || e.data === 150 ? "its owner doesn't let it play outside YouTube" : "YouTube couldn't play it"; } },
      });
    }));
  }
  pos() { return this.player?.getCurrentTime() ?? 0; }
  len() { return this.player?.getDuration() ?? 0; }
  isPlaying() { return this.playing; }
  /** The speed the video really plays at (YouTube rounds what it's asked to the speeds it offers). */
  rate() { return this.player?.getPlaybackRate() ?? 1; }
  /** Whether YouTube's player is up, so its calls do something. */
  isReady() { return !!this.player; }
  play() { this.player?.playVideo(); this.playing = true; }
  pause() { this.player?.pauseVideo(); this.playing = false; }
  seek(s: number) { this.player?.seekTo(Math.max(0, Math.min(this.len() || s, s)), true); }

  /** A press on the deck, as a club player does it (the cue held plays from the mark; let go, back to it). */
  press(p: Press, x?: number) {
    const hot = hotOf(p);
    if (p === "play") { if (this.playing) this.pause(); else this.play(); this.cueHeld = false; }
    else if (p === "cueDown") {
      if (this.playing && !this.cueHeld) { this.seek(this.cue); this.pause(); }
      else { this.cue = this.pos(); this.cueHeld = true; this.play(); }
    } else if (p === "cueUp") { if (this.cueHeld) { this.cueHeld = false; this.pause(); this.seek(this.cue); } }
    else if (hot >= 0) { const at = this.hot[hot]; if (at == null) this.hot[hot] = this.pos(); else this.seek(at); }
    else if (p === "back" || p === "fwd") this.seek(this.pos() + (p === "back" ? -2 : 2));
    else if (p === "seek" && x !== undefined && !this.playing) this.seek(x * this.len());
  }
  /** The jog: a turn moves the video along (1.8 s a turn, as the platter). */
  turn(turns: number) { this.seek(this.pos() + turns * 1.8); }
  /** Each frame: the pitch fader's speed and the channel's volume, sent only when they change. */
  follow(rate: number, volume: number) {
    if (!this.player) return;
    if (Math.abs(rate - this.shownRate) > 0.002) { this.shownRate = rate; this.player.setPlaybackRate(rate); }
    if (volume !== this.shownVol) { this.shownVol = volume; this.player.setVolume(volume); }
  }
  view(): DeckView & { hot: readonly (number | null)[]; cueHeld: boolean } {
    return { name: this.title, who: null, bpm: null, key: null, pos: this.pos(), len: this.len(), playing: this.playing, cue: this.cue, wave: NO_WAVE, hot: this.hot, cueHeld: this.cueHeld };
  }
  destroy() { this.made?.destroy(); this.made = this.player = null; }
}
