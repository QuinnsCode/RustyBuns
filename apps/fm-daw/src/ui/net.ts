// The world connection. On the desktop it's the host's in-process world, which
// saves the project to sqlite. On Cloudflare it's a Durable Object per room, so
// everyone in the room edits one groove. With no world (plain `vite dev`), the
// app still works; it just doesn't save.
import { connectSocket } from "@rustybuns/util/socket";
import { decodeServer, type ClientMsg, type Op, type Project, type ServerMsg } from "../project.ts";

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
  let peers = 0;
  opts.onStatus({ state: "connecting", peers });
  const link = connectSocket<ServerMsg, ClientMsg>(url, {
    decode: decodeServer, queue: 200,
    onMessage: (m) => {
      if (m.t === "snapshot") { opts.onSnapshot(m.project); opts.onStatus({ state: "online", peers }); }
      else if (m.t === "op") opts.onOp(m.op);
      else if (m.t === "peers") { peers = m.n; opts.onStatus({ state: "online", peers }); }
    },
    onClose: (e) => {
      opts.onStatus({ state: "offline", peers: 0 });
      // a few quick retries (host restarting), then back off; no world just stays offline
      return Math.min(1000 * 2 ** (e.tries - 1), 30000);
    },
    onOpen: () => opts.onStatus({ state: "connecting", peers }),
  });
  return {
    send: (op) => { link.send({ t: "op", op }); },
    init: (project) => { link.send({ t: "init", project }); },
    close: () => link.close(),
  };
}
