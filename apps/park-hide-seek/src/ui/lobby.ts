// Playing with friends, page side: the lobby is Qollab's party (apps/eqosys/src/party.ts), not ours. `?party=CODE` shows who
// is in and who is ready; when the host starts, everyone carries on in the room named for that code (the World, edge/worker.ts).
// What stays ours is the hunt's own lobby after that: the zone, mode and weather the host picks.
import type { PartyMember } from "@rustybuns/util/eqosys";
import { ROOM } from "../api.ts";
import { login, party } from "./eqosys.ts";

/** A party code in the page's address, or null. Qollab's codes are six letters, which is a valid room. */
export const partyCode = (search: string) => {
  const code = (new URLSearchParams(search).get("party") ?? "").toUpperCase();
  return ROOM.test(code) ? code : null;
};
export const partyLink = (code: string) => `${location.origin}${location.pathname}?party=${code}`;

/** The World gives the host to whoever reaches a room first, so the others come in after the host's seat 0. */
export const arriveIn = (seat: number) => (seat === 0 ? 0 : 700 + 200 * Math.min(seat, 8));

/** Mint a party. Null when signed out or eqosys refused. */
export const makeParty = () => party().make();

/** Show the party in `box` (members, Ready or Start, copy link) and call `go(room)` when the host starts. */
export function joinParty(code: string, box: HTMLElement, go: (room: string) => void, say: (note: string) => void) {
  const p = party();
  let members: PartyMember[] = [], note = "";
  const draw = () => {
    const mine = members.find((m) => m.name === login()?.name);
    const line = Object.assign(document.createElement("div"), { textContent: `Party ${code}: ${members.map((m) => `${m.name}${m.host ? " (host)" : m.ready ? " ready" : ""}`).join(", ") || "joining..."}${note ? ` - ${note}` : ""}` });
    box.replaceChildren(line,
      ...(mine?.host ? [button("Start", () => p.start())] : [button(mine?.ready ? "Not ready" : "Ready", () => p.ready(!mine?.ready))]),
      button("Copy link", () => void navigator.clipboard?.writeText(partyLink(code)).then(() => say("Link copied"), () => {})));
  };
  p.onMembers((m) => { members = m; note = ""; draw(); });
  p.onRefused((why) => { note = why; draw(); });
  p.onGone((why) => { note = why; members = []; draw(); });
  p.onStart((s) => { box.hidden = true; setTimeout(() => go(s.room), arriveIn(s.seat)); });
  p.join(code);
  box.hidden = false;
  draw();
  return () => { p.leave(); box.hidden = true; };
}

function button(text: string, on: () => void) {
  const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  b.addEventListener("click", on);
  return b;
}
