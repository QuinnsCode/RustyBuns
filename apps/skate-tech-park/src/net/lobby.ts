// The party lobby, page side: a signed-in rider opens `?party=CODE`, sees who is in and who is ready, and when the
// host starts, everyone carries on in `?room=CODE` (the same world DO, edge/world.ts). Qollab's side: apps/eqosys/src/party.ts.
import { lobbyPanel } from "@rustybuns/util/lobby";
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
export const joinParty = (code: string, box: HTMLElement, search: string) =>
  lobbyPanel({ code, box, party: party(), name: () => login()?.name, link: () => location.href, onStart: (s) => { location.search = roomUrl(search, s.room); } });
