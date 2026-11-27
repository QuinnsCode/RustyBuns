// Going live (#5878): the decks' master, what the room's PA gets, streamed to a listen link anyone can open. Nothing
// leaves the computer until the DJ presses Go live, and the link goes quiet when they stop. The sound is the decks'
// MediaRecorder at 128 kb/s, a WebM chunk a second over a socket to the set's Listen Durable Object (src/listen.ts),
// which passes it on to every listener; the track list goes along as each track comes in. The link is the same every
// time from this browser (its id and key are kept here), so a listener can keep it.
import { check, obj, str } from "@rustybuns/util/guard";
import { hex } from "@rustybuns/util/bytes";
import { CueWatch, type OnAir } from "./record.ts";
import type { Curve } from "./mixer.ts";
import { DJ_KEY, LIVE_BITRATE, LIVE_TYPE, SET_ID, SetSays, limitSays, listenPath, listenSocket, type DjSays, type Limit } from "./live-wire.ts";

const STORE = "qdjs-live";
const Mine = obj({ id: str(10, { re: SET_ID }), key: str(32, { re: DJ_KEY }) });

/** This browser's link: made once, then kept. */
export function myLink(store: Pick<Storage, "getItem" | "setItem"> = localStorage): { id: string; key: string } {
  let kept: unknown = null;
  try { kept = JSON.parse(store.getItem(STORE) ?? "null"); } catch { /* made anew */ }
  const had = check(Mine, kept);
  if (had) return had;
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789", r = crypto.getRandomValues(new Uint8Array(10));
  const made = { id: [...r].map((b) => abc[b % abc.length]).join(""), key: hex(crypto.getRandomValues(new Uint8Array(16))) };
  store.setItem(STORE, JSON.stringify(made));
  return made;
}

/** Whether this browser can stream a set (Opus in WebM: Chrome, Edge, Firefox; not Safari). */
export const canGoLive = () => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(LIVE_TYPE);

export type LiveState = { on: boolean; link: string; ears: number; seconds: number; sent: number; limit: Limit | null };

/** One live set at a time from these decks. */
export class LiveSet {
  private ws: WebSocket | null = null;
  private rec: MediaRecorder | null = null;
  private t0 = 0;
  private ears = 0;
  private sent = 0;
  private watch = new CueWatch();
  private mine: { id: string; key: string };
  /** Called when the set starts, stops (`why` says why when it wasn't the DJ) or its listener count changes. */
  onChange: (why?: string) => void = () => {};
  /** The free limit that refused or ended the last set (its number with it), until the next go-live. */
  limit: { why: Limit; n: number } | null = null;

  constructor(private origin = location.origin, store?: Pick<Storage, "getItem" | "setItem">) { this.mine = myLink(store); }

  get on(): boolean { return !!this.rec; }
  /** The link to send people. */
  get link(): string { return `${this.origin}${listenPath(this.mine.id)}`; }
  state(now = performance.now()): LiveState {
    return { on: this.on, link: this.link, ears: this.ears, seconds: this.on ? (now - this.t0) / 1000 : 0, sent: this.sent, limit: this.limit?.why ?? null };
  }

  /** Go live with `stream` under `name`: resolves false when the link can't be reached (no server, or not this DJ's)
   * or a free limit turned it away (`limit` says which). */
  start(stream: MediaStream, name: string): Promise<boolean> {
    if (this.ws) return Promise.resolve(true);
    const ws = new WebSocket(listenSocket(this.origin, this.mine.id, this.mine.key));
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.limit = null;
    return new Promise((done) => {
      let started = false;
      // the set takes this socket once it counts its listeners to it; a limit sends its end instead
      const begin = () => {
        started = true;
        const rec = new MediaRecorder(stream, { mimeType: LIVE_TYPE, audioBitsPerSecond: LIVE_BITRATE });
        // in order: each chunk's bytes are read after the one before it went
        let line = Promise.resolve();
        rec.ondataavailable = (e) => {
          if (!e.data.size) return;
          line = line.then(async () => {
            const b = await e.data.arrayBuffer();
            if (ws.readyState === WebSocket.OPEN) { ws.send(b); this.sent += b.byteLength; }
          });
        };
        rec.start(1000);
        this.rec = rec; this.t0 = performance.now(); this.sent = 0; this.ears = 0; this.watch.reset();
        this.onChange();
        done(true);
      };
      ws.onopen = () => this.send({ t: "name", name });
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        let v: unknown;
        try { v = JSON.parse(e.data); } catch { return; }
        const m = check(SetSays, v);
        if (m?.t === "ears") { if (!started) begin(); this.ears = m.ears ?? 0; this.onChange(); }
        else if (m?.t === "end" && m.why) this.limit = { why: m.why, n: m.n ?? 0 };
      };
      ws.onclose = (e) => {
        const was = this.ws === ws;
        if (was) this.halt();
        if (!started) done(false);
        else if (was) this.onChange(this.limit ? limitSays(this.limit.why, this.limit.n).title : e.code === 4002 ? "Live from another tab now" : "The listen link dropped");
      };
    });
  }

  /** Each deck now: a track coming in goes to the listeners' track list. */
  tick(decks: readonly [OnAir, OnAir], xfader: number, curve: Curve, now = performance.now()) {
    if (!this.rec) return;
    for (const cue of this.watch.tick(decks, xfader, curve, (now - this.t0) / 1000)) this.send({ t: "cue", cue });
  }

  /** Stop: the link goes quiet and every listener is told the set is over. */
  stop() {
    const ws = this.ws;
    this.halt();
    ws?.close(1000, "set over");
    this.onChange();
  }

  private halt() {
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.rec = null; this.ws = null; this.ears = 0;
  }
  private send(m: DjSays) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
}
