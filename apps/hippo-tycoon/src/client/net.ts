// The world socket: backoff reconnects, the version handshake, a ping for the
// HUD, and a clean close when the page goes away. It speaks messages, not
// frames; NetDriver turns those into something to draw.
import { CLOSE_FULL, CLOSE_REPLACED, CLOSE_VERSION, PROTO_VERSION, decodeServer, type ClientMsg, type ServerMsg } from "../engine/wire.ts";

export type NetState = "connecting" | "online" | "offline" | "refused";

export interface NetEvents {
  onMessage(m: ServerMsg): void;
  onState(s: NetState, message?: string): void;
  onPing(ms: number): void;
  /** Called on every (re)connect after the hello was sent: resend held state. */
  onOpen(): void;
}

/** Codes that mean "do not try again": the server told us why. */
const FINAL = new Set([CLOSE_VERSION, CLOSE_REPLACED, CLOSE_FULL]);

export class NetSocket {
  private ws: WebSocket | null = null;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private pingAt = new Map<number, number>();
  private pingN = 0;
  private lastErr = "";

  /** `open` builds a fresh WebSocket each time (the URL carries identity and the join code). */
  constructor(private open: () => WebSocket, private ev: NetEvents) {
    this.connect();
    window.addEventListener("pagehide", this.leave);
  }

  private leave = () => { this.closed = true; try { this.ws?.close(1000, "page unload"); } catch { /* already gone */ } };

  private connect() {
    this.ev.onState("connecting");
    let ws: WebSocket;
    try { ws = this.open(); } catch (e) { this.ev.onState("refused", String(e)); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0; this.lastErr = "";
      ws.send(JSON.stringify({ t: "hello", v: PROTO_VERSION }));
      this.ev.onState("online");
      this.ev.onOpen();
      this.pinger = setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (e) => {
      const m = decodeServer(e.data);
      if (!m) return;
      if (m.t === "pong") { const t = this.pingAt.get(m.n); if (t !== undefined) { this.pingAt.delete(m.n); this.ev.onPing(performance.now() - t); } return; }
      if (m.t === "err") this.lastErr = m.msg;
      if (m.t === "hello" && m.v !== PROTO_VERSION) { this.lastErr = `The server speaks protocol ${m.v}, this game speaks ${PROTO_VERSION}.`; this.closed = true; ws.close(); this.ev.onState("refused", this.lastErr); return; }
      this.ev.onMessage(m);
    };
    ws.onclose = (e) => {
      if (this.pinger) { clearInterval(this.pinger); this.pinger = null; }
      this.ws = null;
      if (this.closed && !FINAL.has(e.code)) { this.ev.onState("offline"); return; }
      if (FINAL.has(e.code)) { this.closed = true; this.ev.onState("refused", this.lastErr || e.reason || "The room refused the connection."); return; }
      this.ev.onState("offline", this.lastErr || undefined);
      // quick retries first (a host restarting), then back off to 15 s
      this.timer = setTimeout(() => this.connect(), Math.min(500 * 2 ** this.tries++, 15000));
    };
  }

  private ping() {
    const n = ++this.pingN;
    this.pingAt.set(n, performance.now());
    if (this.pingAt.size > 8) this.pingAt.delete(this.pingAt.keys().next().value!);
    this.send({ t: "ping", n });
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  close() {
    this.closed = true;
    window.removeEventListener("pagehide", this.leave);
    if (this.timer) clearTimeout(this.timer);
    if (this.pinger) clearInterval(this.pinger);
    try { this.ws?.close(1000, "bye"); } catch { /* already gone */ }
  }
}
