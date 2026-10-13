// The page's end of a battle: one WebSocket to a world (this machine's, or a friend's on the
// LAN), the welcome (JSON) and snapshots (binary) coming in, this page's Input going out. Inputs
// go about 30 times a second, and straight away when a key is tapped, so a quick click is never
// lost. Each carries the newest snapshot the page applied, which the world sends deltas against.
// They go even when nothing changed: the world echoes the newest one's number to replay from.

import { worldSocket } from "@rustybuns/shell-bun/client";
import type { Input } from "../sim/game.ts";
import { decodeSnap, type FromWorld, type Setup, type ToWorld } from "../net/wire.ts";

/** An Input at most this often. */
const SEND_MS = 33;

export class Battle {
  onMessage: (m: FromWorld) => void = () => {};
  onClose: (error: string | null) => void = () => {};
  private ws: WebSocket;
  private closed = false;
  private seen = false;
  private queue: string[] = [];
  private sentAt = 0;
  private lastSent = "";

  /** host: this machine's world (target "/ws"). guest: `http://ip:port/ws`, with the join passphrase in params. Online, both are "/ws" with the room code in params. */
  constructor(readonly kind: "host" | "guest", target: string, params: Record<string, string | undefined>) {
    this.ws = worldSocket(target, params);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => { for (const m of this.queue.splice(0)) this.ws.send(m); };
    this.ws.onmessage = (e) => {
      let m: FromWorld | null;
      try { m = typeof e.data === "string" ? JSON.parse(e.data) : decodeSnap(e.data); } catch { return; }
      if (!m) return;
      this.seen = true;
      this.onMessage(m);
    };
    this.ws.onclose = (e) => {
      if (this.closed) return;
      // A refused upgrade gives the page no status code, so name the usual causes.
      this.onClose(e.code === 4001 ? "You joined from somewhere else."
        : e.code === 4002 ? "That battle is full."
        : e.code === 4003 ? "The battle closed: nobody had played for five minutes."
        : this.seen ? "Lost the connection to the battle."
        : params.room ? "Couldn't reach the battle. Check the room code and your connection."
        : kind === "guest" ? "Couldn't join. Check the address and passphrase, that the host clicked Host, that you're on the same network, and that you both run the same build."
        : "Couldn't open the battle on this machine.");
    };
  }

  private raw(m: ToWorld) {
    const s = JSON.stringify(m);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (this.queue.length < 20) this.queue.push(s);
  }

  setup(setup: Setup) { this.raw({ t: "setup", setup }); }

  /** This frame's input, and the newest snapshot applied: sent if it's been SEND_MS, or now if it taps something (a jump, a roll, a shot, a weapon). */
  input(i: Input, now: number, ack: number) {
    const tap = i.jump || i.roll || i.weapon !== undefined || (i.fire && !this.lastSent.includes('"fire":true'));
    if (!tap && now - this.sentAt < SEND_MS) return;
    const s = JSON.stringify(i);
    this.sentAt = now, this.lastSent = s;
    this.raw({ t: "in", i, ack });
  }

  close() { this.closed = true; this.ws.close(1000); }
}
