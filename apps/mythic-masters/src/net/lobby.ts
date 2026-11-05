// The party lobby, page side (#3663): a signed-in player's "Walk together" mints an eqosys party and opens `?party=CODE`,
// friends open the same link, see who is in and who is ready, and when the host starts, everyone walks the world in
// `?room=ROOM` (the room Qollab gave the party, net/online.ts). Qollab's side: apps/eqosys/src/party.ts.
import { lobbyPanel } from "@rustybuns/util/lobby";
import { login, party } from "../account.ts";

export const partyCode = (search: string) => (new URLSearchParams(search).get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;

/** Mint a party and move this page to its lobby, in the world. Signed out or refused, it returns false. */
export async function openParty(): Promise<boolean> {
  const code = await party().make();
  if (!code) return false;
  location.search = `?world=1&party=${code}`;
  return true;
}

/** Join the page's party and keep `box` showing it: members, a Ready button, Start for the host, Copy link. */
export const joinParty = (code: string, box: HTMLElement) =>
  lobbyPanel({ code, box, party: party(), name: () => login()?.name, link: () => location.href, onStart: (s) => { location.search = `?world=1&room=${s.room}`; } });
