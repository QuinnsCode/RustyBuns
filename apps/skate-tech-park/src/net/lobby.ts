// The party lobby, page side: a signed-in rider opens `?party=CODE`, sees who is in and who is ready, and when the
// host starts, everyone carries on in `?room=CODE` (the same world DO, edge/world.ts). Qollab's side: apps/eqosys/src/party.ts.
import type { PartyMember } from "@rustybuns/util/eqosys";
import { login, party } from "../eqosys.ts";

export const partyCode = (search: string) => (new URLSearchParams(search).get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;

/** Where a started party goes: the world for its room, on the level the page is on. */
export const roomUrl = (search: string, room: string) => {
  const q = new URLSearchParams(search);
  q.delete("party"); q.set("room", room);
  return `?${q}`;
};

/** Mint a party and move this page to it. Signed out or refused, it returns false and the caller falls back. */
export async function openParty(search: string): Promise<boolean> {
  const code = await party().make();
  if (!code) return false;
  const q = new URLSearchParams(search); q.set("party", code);
  location.search = `?${q}`;
  return true;
}

/** Join the page's party and keep `box` showing it: members, a Ready button, and Start for the host. */
export function joinParty(code: string, box: HTMLElement, search: string) {
  const p = party();
  let members: PartyMember[] = [], note = "";
  const me = () => members.find((m) => m.name === login()?.name);
  const draw = () => {
    const mine = me();
    box.replaceChildren(
      Object.assign(document.createElement("div"), { textContent: `Party ${code}: ${members.map((m) => `${m.name}${m.host ? " (host)" : m.ready ? " ready" : ""}`).join(", ") || "joining..."}${note ? ` - ${note}` : ""}` }),
      ...(mine?.host
        ? [button("Start", () => p.start())]
        : [button(mine?.ready ? "Not ready" : "Ready", () => p.ready(!mine?.ready))]),
      button("Copy link", () => void navigator.clipboard?.writeText(location.href).catch(() => {})),
    );
  };
  p.onMembers((m) => { members = m; note = ""; draw(); });
  p.onRefused((why) => { note = why; draw(); });
  p.onGone((why) => { note = why; members = []; draw(); });
  p.onStart((s) => { location.search = roomUrl(search, s.room); });
  p.join(code);
  draw();
}

function button(text: string, on: () => void) {
  const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  b.addEventListener("click", on);
  return b;
}
