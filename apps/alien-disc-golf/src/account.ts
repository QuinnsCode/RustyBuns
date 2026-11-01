// Signing in through eqosys, so the scorecard can carry the player's name. The game has no server-side players
// (its Worker only relays NOAA's wind), so this is just the sign-in and the name: the token is kept for
// when a leaderboard needs a Worker to check it with `TokenChecker`.
import { eqosys } from "@rustybuns/util/eqosys";
import { icon } from "./icons.ts";

/** This game's id in eqosys's APPS. */
export const APP = "alien-disc-golf";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window plays as a guest. */
export const SIGN_IN_FROM = ["https://alien-disc-golf.notryanquinn.workers.dev"];

export const { signIn, finishSignIn, login, signOut, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "adg" });

/** What the header's account slot holds: the player's name with a way out, a way in, or nothing for a guest who can't sign in here. */
export function accountHtml(): string {
  const who = login();
  if (who) return `<span class="who">${esc(who.name)}</span><button type="button" id="sign-out" class="icon" title="Sign out" aria-label="Sign out">${icon("log-out")}</button>`;
  return canSignIn() ? `<button type="button" id="sign-in" class="icon" title="Sign in" aria-label="Sign in">${icon("log-in")}</button>` : "";
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Fill the slot and wire its button. `error` is what went wrong coming back from eqosys, if anything. */
export function mountAccount(slot: HTMLElement, error = ""): void {
  slot.innerHTML = accountHtml() + (error ? `<small class="note">${esc(error)}</small>` : "");
  slot.querySelector("#sign-in")?.addEventListener("click", () => void signIn());
  slot.querySelector("#sign-out")?.addEventListener("click", () => { signOut(); mountAccount(slot); });
}
