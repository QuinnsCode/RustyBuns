// The page's end of a battle: one WebSocket to a world (this machine's, or a friend's on the
// LAN), the welcome and snapshots coming in, this page's Input going out. Inputs go about 30
// times a second, and straight away when a key is tapped, so a quick click is never lost.

import { worldSocket } from "@rustybuns/shell-bun/client";
import type { Input } from "../sim/game.ts";
import type { FromWorld, Setup, ToWorld } from "../net/wire.ts";

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

  /** host: this machine's world (target "/ws"). guest: `http://ip:port/ws`, with the join passphrase in params. */
  constructor(readonly kind: "host" | "guest", target: string, params: Record<string, string | undefined>) {
    this.ws = worldSocket(target, params);
    this.ws.onopen = () => { for (const m of this.queue.splice(0)) this.ws.send(m); };
    this.ws.onmessage = (e) => {
      let m: FromWorld;
      try { m = JSON.parse(e.data); } catch { return; }
      this.seen = true;
      this.onMessage(m);
    };
    this.ws.onclose = (e) => {
      if (this.closed) return;
      // A refused upgrade gives the page no status code, so name the usual causes.
      this.onClose(e.code === 4001 ? "You joined from somewhere else."
        : e.code === 4002 ? "That battle is full."
        : this.seen ? "Lost the connection to the battle."
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

  /** This frame's input: sent if it's been SEND_MS, or now if it taps something (a jump, a roll, a shot, a weapon). */
  input(i: Input, now: number) {
    const tap = i.jump || i.roll || i.weapon !== undefined || (i.fire && !this.lastSent.includes('"fire":true'));
    if (!tap && now - this.sentAt < SEND_MS) return;
    const s = JSON.stringify(i);
    if (!tap && s === this.lastSent && now - this.sentAt < 250) return;
    this.sentAt = now, this.lastSent = s;
    this.raw({ t: "in", i });
  }

  close() { this.closed = true; this.ws.close(1000); }
}
