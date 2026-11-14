// Battles with friends online, page side: the lobby is Qollab's party (apps/eqosys/src/party.ts), not ours. `?party=CODE`
// shows who is in and who is ready; when the host starts, everyone carries on in the room named for that code, the same
// /ws?room=CODE world a typed room code reaches (edge/worker.ts). The host's page picks the level, mode and repo there.
import { lobbyPanel } from "@rustybuns/util/lobby";
import { hub, login, party } from "../eqosys.ts";

/** A room code, as the Worker takes it (edge/worker.ts's ROOM, which the page doesn't import: it pulls in the world). */
export const ROOM = /^[A-Z0-9]{4,8}$/;

/** A party code in the page's address, or null. Qollab's codes are six letters, which is a valid room. */
export const partyCode = (search: string) => {
  const code = (new URLSearchParams(search).get("party") ?? "").toUpperCase();
  return ROOM.test(code) ? code : null;
};
export const partyLink = (code: string) => `${location.origin}${location.pathname}?party=${code}`;

/** Mint a party. Null when signed out or eqosys refused. */
export const makeParty = () => party().make();

/** Show the party in `box` (members, Ready or Start, copy link) and call `go(room, seat)` when the host starts: seat 0 is the host. */
export const joinParty = (code: string, box: HTMLElement, go: (room: string, seat: number) => void, say: (note: string) => void) =>
  lobbyPanel({ code, box, party: party(), hub: hub(), name: () => login()?.name, link: () => partyLink(code), say,
    onStart: (s) => { box.hidden = true; go(s.room, s.seat); } });
