// The jukebox's podcast station: the first feed in your podcasts.json (feed.ts), episode after episode, picking up where
// you left off. It plays through the office's own buses like the other tunes, so volume, mute and the jukebox fading
// with distance all apply. Where your place is kept: this browser (localStorage), one key per feed.
import { after, start, type Place } from "./queue.ts";
import type { Episode } from "./feed.ts";

const SAVE_EVERY = 5; // seconds of tune time between saves of where you are

const key = (feed: string) => `rb-podcast:${feed}`;
function saved(feed: string): Place | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(feed)) ?? "null");
    if (typeof v === "object" && v !== null && "id" in v && "t" in v && typeof v.id === "string" && typeof v.t === "number") return { id: v.id, t: v.t };
  } catch {}
  return null;
}
const EVERYWHERE = "rb-podcast-everywhere"; // per user: hear the podcast at full volume anywhere in the office
export function everywhere(): boolean { try { return localStorage.getItem(EVERYWHERE) === "1"; } catch { return false; } }
function setEverywhere(on: boolean) { try { localStorage.setItem(EVERYWHERE, on ? "1" : "0"); } catch {} }
function save(feed: string, p: Place) { try { localStorage.setItem(key(feed), JSON.stringify(p)); } catch {} }

export class Podcast {
  private out: GainNode;
  private audio = new Audio();
  private stopped = false;
  private feed = "";
  private order: "oldest" | "newest" = "oldest";
  private episodes: Episode[] = [];
  private ep: Episode | null = null;
  private saveAt = 0;
  private button: HTMLButtonElement | null = null;

  constructor(private ctx: AudioContext, private into: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    this.route();
    this.addButton();
    // with CORS the sound goes through the office's buses; a feed whose audio sends none still plays, unrouted
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    ctx.createMediaElementSource(this.audio).connect(this.out);
    this.audio.addEventListener("ended", () => this.advance());
    this.audio.addEventListener("error", () => this.advance());
    void this.open();
  }

  /** Through the jukebox's bus (fades with distance), or straight to the speakers when you chose full volume anywhere. */
  private route() {
    this.out.disconnect();
    this.out.connect(everywhere() ? this.ctx.destination : this.into);
  }

  private addButton() {
    if (typeof document === "undefined") return;
    const b = document.createElement("button");
    const paint = () => {
      const on = everywhere();
      b.title = on ? "Podcast: full volume everywhere (click for jukebox distance)" : "Podcast: fades with distance (click for full volume everywhere)";
      b.setAttribute("aria-pressed", String(on));
      b.style.opacity = on ? "1" : "0.6";
    };
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;
    b.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:50;padding:6px;border-radius:6px;border:1px solid #888;background:#222;color:#fff;cursor:pointer";
    b.onclick = () => { setEverywhere(!everywhere()); this.route(); paint(); };
    paint();
    document.body.append(b);
    this.button = b;
  }

  private async open() {
    try {
      const feeds: unknown = await (await fetch("/__rb/podcast")).json();
      const first = typeof feeds === "object" && feeds !== null && "feeds" in feeds && Array.isArray(feeds.feeds) ? feeds.feeds[0] : null;
      if (typeof first?.id !== "string") return void console.warn("[podcast] no feeds: add one to ~/.config/agent-office/podcasts.json");
      const res: unknown = await (await fetch(`/__rb/podcast/episodes?feed=${encodeURIComponent(first.id)}`)).json();
      if (typeof res !== "object" || res === null || !("episodes" in res) || !Array.isArray(res.episodes)) return;
      this.feed = first.id;
      this.order = "order" in res && res.order === "newest" ? "newest" : "oldest";
      this.episodes = res.episodes.filter((e): e is Episode => typeof e?.url === "string" && typeof e.id === "string");
      const at = start(this.episodes, this.order, saved(this.feed));
      if (!at || this.stopped) return;
      this.play(at.ep, at.t);
    } catch (e) { console.warn("[podcast] couldn't load", e); }
  }

  private play(ep: Episode, t: number) {
    this.ep = ep;
    this.audio.src = ep.url;
    if (t > 0) this.audio.currentTime = t;
    void this.audio.play().catch((e) => console.warn("[podcast] couldn't play", e));
  }

  private advance() {
    if (this.stopped || !this.ep) return;
    const next = after(this.episodes, this.order, this.ep);
    if (!next) return;
    save(this.feed, { id: next.id, t: 0 });
    this.play(next, 0);
  }

  private remember() {
    if (this.ep && this.audio.currentTime > 0) save(this.feed, { id: this.ep.id, t: Math.floor(this.audio.currentTime) });
  }

  /** `t` is seconds since the tune went on, every 150 ms. */
  tick(t: number) {
    if (this.stopped || t < this.saveAt) return;
    this.saveAt = t + SAVE_EVERY;
    this.remember();
  }

  /** How much the jukebox's lights pulse: gently, with the talking. */
  beat(t: number) {
    return 0.2 + 0.1 * Math.sin(t * 1.3);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.button?.remove();
    this.remember();
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 1);
    setTimeout(() => { this.audio.pause(); this.audio.removeAttribute("src"); }, 1100);
  }
}
