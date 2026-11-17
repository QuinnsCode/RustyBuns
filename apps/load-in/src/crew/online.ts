// The page's side of a crew room: a socket to /ws?room=CODE&level=garage that sends your pose every 50 ms and your
// grabs, drops and cable ends as they happen (sync.ts), and hands each message from the room to `hear`. The party's Start opens
// one; so does `?room=CODE` in the address. With no Worker behind /ws (the vite dev server) it gives up and you play alone.
import { guestId } from "@rustybuns/util/eqosys";
import { connectSocket, SEAT_CLOSE, seatClosed, type Link } from "@rustybuns/util/socket";
import type { World } from "../sim.ts";
import type { Cables } from "../cables/cables.ts";
import { readServer, type Sent, type ServerMsg } from "./room.ts";
import { hear, outbox, poseOf, synced } from "./sync.ts";
import { who } from "../eqosys.ts";

const SEND_MS = 50;

export const roomCode = (search: string) => (new URLSearchParams(search).get("room") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;

export interface Online { readonly room: string; status: "joining" | "in" | "off"; note: string; tick(w: World, now: number): void; close(): void }

export function joinCrew(room: string, level: string, world: () => World, cables: () => Cables, onChange: () => void, switches?: () => Set<string>): Online {
  const s = synced();
  // A signed-in player goes by their eqosys token, a guest by an id this tab keeps (two tabs, two roadies).
  const url = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws?${new URLSearchParams({ room, level, ...who(guestId("load-in.uid", { tab: true })) })}`;
  };
  let sentAt = 0;
  const on: Online = {
    room, status: "joining", note: "",
    tick(w, now) {
      if (!link.open) return;
      for (const m of outbox(w, s, cables(), switches?.())) link.send(m);
      if (now - sentAt >= SEND_MS) { sentAt = now; link.send(poseOf(w)); }
    },
    close: () => link.close(1000),
  };
  const link: Link<Sent> = connectSocket<ServerMsg, Sent>(url, {
    decode: readServer,
    onOpen: () => { on.status = "in"; on.note = ""; s.held = null; onChange(); },
    onMessage: (m) => { hear(world(), s, m, cables(), switches?.()); if (m.t === "refused") { on.note = m.why; } onChange(); },
    onClose: (e) => {
      world().crew = [];
      on.note = seatClosed(e.code) ?? (e.seen ? "Lost the crew room; trying again." : `No crew room ${room} here; playing alone.`);
      on.status = e.code === SEAT_CLOSE.replaced || !e.seen ? "off" : "joining";
      onChange();
      return on.status === "joining" && e.tries < 4 ? 1000 * (1 + e.tries) : null;
    },
  });
  return on;
}
