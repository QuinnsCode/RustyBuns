// The party lobby, page side: a signed-in rider opens `?party=CODE`, sees who is in and who is ready, and when the
// host starts, everyone carries on in `?room=CODE` (the same world DO, edge/world.ts). Qollab's side: apps/eqosys/src/qollab/party.ts.
// A rider signed out at the link signs in beside the park first (`signInToJoin`), then joins.
import { lobbyPanel, signInToJoin } from "@rustybuns/util/lobby";
import { canSignIn, hub, login, party, signInHere } from "../eqosys.ts";

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

/** Join the page's party and keep `box` showing it: members, a Ready button, Start for the host, Copy friend link. Signed
 * out, "Sign in to join Ada's party" first, eqosys beside the park, and then the lobby with no reload. */
export function joinParty(code: string, box: HTMLElement, search: string) {
  const join = () => lobbyPanel({ code, box, party: party(), hub: hub(), name: () => login()?.name, link: () => location.href, onStart: (s) => { location.search = roomUrl(search, s.room); } });
  if (login()) join(); else signInToJoin({ box, code, game: "Skate Tech Park", account: { canSignIn, signInHere }, joined: join });
}
