// Playing with friends, page side: the lobby is Qollab's party (apps/eqosys/src/qollab/party.ts), the way Park Hide & Seek's
// is. "With friends" mints a party and puts `?party=CODE` in the address; a friend opens that link, says Ready, the host
// says Start, and every page carries on in the room named for the code (the World, edge/worker.ts). Seats don't matter in
// a race, so no start ticket: the party's Start is the only one anybody presses, since the host's page starts the mission
// once everyone from the party is in the safehouse. Quick play keeps its own matchmaker (edge/match.ts).
import { lobbyPanel } from "@rustybuns/util/lobby";
import { ROOM } from "./api.ts";
import type { View } from "./match/game.ts";
import { hub, login, party } from "./eqosys.ts";

/** A party code in the page's address, or null. Qollab's codes are six letters, which is a valid room. */
export const partyCode = (search: string) => {
  const code = (new URLSearchParams(search).get("party") ?? "").toUpperCase();
  return ROOM.test(code) ? code : null;
};
export const partyLink = (code: string) => `${location.origin}${location.pathname}?party=${code}`;

/** Mint a party. Null when signed out or eqosys refused. */
export const makeParty = () => party().make();

/** Who the party sent to the room: how many, and whether this page is the host's (seat 0) and so starts the mission. */
export interface Arrival { room: string; host: boolean; expect: number }

/**
 * Show the party in `box` (members, Ready or Start, copy link) and call `go` with the arrival when the host starts.
 * Returns the way out of the party.
 */
export function joinParty(code: string, box: HTMLElement, go: (a: Arrival) => void, say: (note: string) => void) {
  const p = party();
  let count = 1;
  p.onMembers((m) => { count = Math.max(1, m.length); });
  return lobbyPanel({ code, box, party: p, hub: hub(), name: () => login()?.name, link: () => partyLink(code), say,
    onStart: (s) => { box.hidden = true; go({ room: s.room, host: s.seat === 0, expect: count }); } });
}

/**
 * Should this page send the mission's start now? Only the host's, only in the safehouse, and once everyone the party sent
 * is in (the lobby has no bots). Anyone may still press "Start the mission" themselves if a friend never turns up.
 */
export const partyReady = (a: Arrival | null, v: View) =>
  !!a?.host && v.phase === "lobby" && v.players.filter((p) => p.online).length >= a.expect;
