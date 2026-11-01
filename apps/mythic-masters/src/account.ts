// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id, and the
// title's account row. Mythic Masters has no server and no player identity yet (a local 1v1 and a save in the
// page), so there is no token to check anywhere: signing in only gives the title a name to greet.
import { eqosys, type Login } from "@rustybuns/util/eqosys";
import { esc } from "@rustybuns/util";
import { icon } from "./icons.ts";

/** This game's id in eqosys's APPS. */
export const APP = "mythic-masters";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origins eqosys sends players back to. Empty until the game is deployed (MANUAL RUN issue): until then only a
 * local eqosys (the `mm.eqosys` setting) can sign anyone in, and everyone else sees no sign-in control. */
export const SIGN_IN_FROM: string[] = [];

export const { signIn, finishSignIn, login, signOut, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "mm" });

/** The title's account row: the player's eqosys name and a way out, or a way in; nothing where eqosys can't send them back. */
export function accountHtml(who: Login | null, can: boolean, note = ""): string {
  const n = note ? `<small class="note">${esc(note)}</small>` : "";
  if (who) return `<span class="rider">${esc(who.name)}</span><button id="signOut" title="Sign out" aria-label="Sign out">${icon("log-out")}</button>${n}`;
  return (can ? `<button id="signIn" title="Sign in" aria-label="Sign in">${icon("log-in")}</button>` : "") + n;
}
