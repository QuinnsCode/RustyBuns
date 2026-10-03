// The world connection. On the desktop it's the host's in-process world, which
// saves the project to sqlite. On Cloudflare it's a Durable Object per room, so
// everyone in the room edits one groove. With no world (plain `vite dev`), the
// app still works; it just doesn't save.
import type { Op, Project } from "../project.ts";

export type NetStatus = { state: "connecting" | "online" | "offline"; peers: number };

export interface Net {
  send(op: Op): void;
  /** Seed an empty world with this project. */
  init(project: Project): void;
  close(): void;
}

export function connect(opts: {
  /** Called with the saved project, or null when the world is empty. */
  onSnapshot(p: Project | null): void;
  onOp(op: Op): void;
  onStatus(s: NetStatus): void;
}): Net {
  const room = new URLSearchParams(location.search).get("room");
  const url = new URL(`ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws`);
  if (room) url.searchParams.set("room", room);
  let ws: WebSocket | null = null;
  let closed = false;
  let tries = 0;
  let peers = 0;
  const queue: string[] = [];

  const open = () => {
    opts.onStatus({ state: "connecting", peers });
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; for (const m of queue.splice(0)) ws!.send(m); };
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "snapshot") { opts.onSnapshot(m.project ?? null); opts.onStatus({ state: "online", peers }); }
      else if (m.t === "op") opts.onOp(m.op);
      else if (m.t === "peers") { peers = m.n; opts.onStatus({ state: "online", peers }); }
    };
    ws.onclose = () => {
      ws = null;
      opts.onStatus({ state: "offline", peers: 0 });
      if (closed) return;
      // a few quick retries (host restarting), then back off; no world just stays offline
      const delay = Math.min(1000 * 2 ** tries++, 30000);
      setTimeout(open, delay);
    };
  };
  open();

  const raw = (m: unknown) => {
    const s = JSON.stringify(m);
    if (ws?.readyState === WebSocket.OPEN) ws.send(s);
    else if (queue.length < 200) queue.push(s);
  };
  return {
    send: (op) => raw({ t: "op", op }),
    init: (project) => raw({ t: "init", project }),
    close: () => { closed = true; ws?.close(); },
  };
}
