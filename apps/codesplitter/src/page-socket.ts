// A page's live socket that survives a deploy (a deploy keeps Durable Object storage but restarts every DO, so every
// socket drops). Built to /page-socket.js for client.html and play.html, and imported by the tests.
// It wraps resilientSocket (packages/shell-bun) with what a page needs on top: say what's going on, resync on every
// reconnect, re-send what couldn't go while down, and count down to a deploy the server announced.
import { resilientSocket, type SocketState } from "@rustybuns/shell-bun/client";

/** What the banner shows. `ok` clears it. */
export type Net = { kind: "ok" } | { kind: "updating" } | { kind: "offline" } | { kind: "deploy"; secs: number };

/** The banner's icon and words for a state, null for none. Labels stay short enough never to wrap. */
export const netBanner = (n: Net): { icon: string; text: string } | null =>
  n.kind === "updating" ? { icon: "refresh-cw", text: "Updating, back in a moment" }
  : n.kind === "offline" ? { icon: "cloud-off", text: "Offline" }
  : n.kind === "deploy" ? { icon: "timer", text: `Update coming in ${n.secs} s, finish your edit` }
  : null;

export interface LiveOpts {
  open: () => WebSocket;
  /** Every message but the deploy notices, which this handles itself. */
  onMessage(data: MessageEvent["data"]): void;
  onNet(n: Net): void;
  /** Reconnected after a drop: read the thing afresh so nothing that landed meanwhile is lost. Runs before `later` work. */
  resync?(): unknown;
  /** The socket stopped being usable: fail whatever waits on an answer. */
  onDrop?(): void;
  now?: () => number;
  delay?: (tries: number) => number;
}

export function liveSocket(o: LiveOpts) {
  const now = o.now ?? Date.now;
  let opened = 0, was: SocketState = "connecting", tick: ReturnType<typeof setInterval> | undefined, drain = false;
  const later = new Set<() => unknown>();
  const stopTick = () => { clearInterval(tick); tick = undefined; };
  const countdown = (at: number) => {
    stopTick();
    const say = () => { const secs = Math.max(0, Math.ceil((at - now()) / 1000)); o.onNet({ kind: "deploy", secs }); };
    say(); tick = setInterval(say, 1000);
  };
  const sock = resilientSocket(o.open, {
    onMessage(data) {
      if (typeof data === "string" && (data.includes('"deploy-soon"') || data.includes('"draining"') || data.includes('"drain-over"'))) {
        let m: { t?: string; at?: number } | null = null;
        try { m = JSON.parse(data); } catch { /* not ours */ }
        if (m?.t === "deploy-soon" && typeof m.at === "number") return countdown(m.at);
        if (m?.t === "draining") { drain = true; return; }
        if (m?.t === "drain-over") { drain = false; stopTick(); o.onNet({ kind: "ok" }); return; }
      }
      o.onMessage(data);
    },
    onState(s) {
      if (s === "online") { stopTick(); drain = false; o.onNet({ kind: "ok" }); }
      else if (s === "reconnecting") { stopTick(); o.onNet({ kind: "updating" }); }
      else if (s === "offline") { stopTick(); o.onNet({ kind: "offline" }); }
      if (was === "online" && s !== "online") o.onDrop?.();
      was = s;
    },
    async onOpen() {
      // Back after a drop: resync first, then send what waited, so a stale edit meets the file as it is now.
      if (opened++) try { await o.resync?.(); } catch { /* the next drop tries again */ }
      for (const f of [...later]) { later.delete(f); try { await f(); } catch { /* it reports its own failure */ } }
    },
  }, { delay: o.delay });
  return {
    get state() { return sock.state; },
    /** The server said new claims are refused for now (a deploy is draining it). */
    get draining() { return drain; },
    send: (data: string) => sock.send(data),
    /** Run `f` once the socket is back and resynced (an edit that couldn't go while down). */
    later: (f: () => unknown) => { later.add(f); },
    close() { stopTick(); later.clear(); sock.close(); },
  };
}
