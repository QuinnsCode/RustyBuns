// The party lobby, page side (#3663): a signed-in player's "Walk together" mints an eqosys party and opens `?party=CODE`,
// friends open the same link, see who is in and who is ready, and when the host starts, everyone walks the world in
// `?room=ROOM` (the room Qollab gave the party, net/online.ts). Qollab's side: apps/eqosys/src/qollab/party.ts.
// Someone signed out who opens the link (#4418) gets one step first: "Sign in to join Ada's party", eqosys in a small
// window beside the game, then the lobby. The step, the link's `from` and the waiting invite key are @rustybuns/util/lobby's.
import { lobbyPanel, signInToJoin as joinStep } from "@rustybuns/util/lobby";
import { canSignIn, hub, login, party, signInHere } from "../account.ts";

export const partyCode = (search: string) => (new URLSearchParams(search).get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;
export { invitedBy } from "@rustybuns/util/lobby";

/** Mint a party and move this page to its lobby, in the world. Signed out or refused, it returns false. */
export async function openParty(): Promise<boolean> {
  const code = await party().make();
  if (!code) return false;
  location.search = `?world=1&party=${code}`;
  return true;
}

/** Join the page's party and keep `box` showing it: members, a Ready button, Start for the host, Copy link, Copy friend link. */
export const joinParty = (code: string, box: HTMLElement) =>
  lobbyPanel({ code, box, party: party(), hub: hub(), name: () => login()?.name, link: () => location.href, onStart: (s) => { location.search = `?world=1&room=${s.room}`; } });

/** Signed out at a party link: "Sign in to join <host>'s party", eqosys beside the game, and `joined` once the login is back. */
export const signInToJoin = (box: HTMLElement, code: string, host: string | null, joined: () => void) =>
  joinStep({ box, code, host, game: "Mythic Masters", account: { canSignIn, signInHere }, joined });
