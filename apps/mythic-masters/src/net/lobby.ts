// The party lobby, page side (#3663): a signed-in player's "Walk together" mints an eqosys party and opens `?party=CODE`,
// friends open the same link, see who is in and who is ready, and when the host starts, everyone walks the world in
// `?room=ROOM` (the room Qollab gave the party, net/online.ts). Qollab's side: apps/eqosys/src/qollab/party.ts.
// Someone signed out who opens the link (#4418) gets one step first: "Sign in to join Ada's party", eqosys in a small
// window beside the game, then the lobby. The link's `from` names who sent it; the invite key waits in @rustybuns/util/lobby.
import { lobbyPanel } from "@rustybuns/util/lobby";
import { eqButton, wearSkin } from "@rustybuns/util/skin";
import { el } from "@rustybuns/util/dom";
import { canSignIn, login, party, signInHere } from "../account.ts";

export const partyCode = (search: string) => (new URLSearchParams(search).get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;

/** Who sent the party link (its `from`): a name to show as text, at most 40 characters, or null. */
export const invitedBy = (search: string): string | null => (new URLSearchParams(search).get("from") ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 40) || null;

/** Mint a party and move this page to its lobby, in the world. Signed out or refused, it returns false. */
export async function openParty(): Promise<boolean> {
  const code = await party().make();
  if (!code) return false;
  location.search = `?world=1&party=${code}`;
  return true;
}

/** This page's address as a party link, signed with the sender's name so whoever opens it knows whose party it is. */
const partyLink = () => {
  const u = new URL(location.href), name = login()?.name;
  if (name) u.searchParams.set("from", name); else u.searchParams.delete("from");
  return u.toString();
};

/** Join the page's party and keep `box` showing it: members, a Ready button, Start for the host, Copy link. */
export const joinParty = (code: string, box: HTMLElement) =>
  lobbyPanel({ code, box, party: party(), name: () => login()?.name, link: partyLink, onStart: (s) => { location.search = `?world=1&room=${s.room}`; } });

/**
 * Signed out at a party link: one step in `box`, "Sign in to join <host>'s party". The button opens eqosys beside the
 * game; `joined` runs once the login is back (the page never reloads). Where eqosys can't send anyone back here, it says so.
 */
export function signInToJoin(box: HTMLElement, code: string, host: string | null, joined: () => void) {
  wearSkin();
  box.classList.add("eq", "rb-lobby");
  box.hidden = false;
  const whose = host ? `${host}'s party` : `party ${code}`;
  const draw = (note = "") => box.replaceChildren(
    el("div", { className: "rb-lobby-who" }, canSignIn() ? `Sign in to join ${whose}` : `You're invited to ${whose}. Signing in opens once Mythic Masters is online.`),
    ...(canSignIn() ? [eqButton({ text: "Sign in", icon: "log-in", show: true, primary: true, onClick: () => {
      // Straight from the click, or the browser blocks the window. Blocked anyway, the whole page goes and comes back to `then`.
      void signInHere(`party:${code}`).then((r) => { if (r.login) joined(); else draw(r.error ?? ""); });
    } })] : []),
    ...(note ? [el("span", { className: "rb-lobby-note" }, ` - ${note}`)] : []),
  );
  draw();
}
