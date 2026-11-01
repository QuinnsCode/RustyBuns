// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The game runs wholly in the page and has no server of its own, so there is no token to pass on: the sign-in
// gives the player their eqosys name, shown on the menu and with their result.
import { createElement, LogIn, LogOut } from "lucide";
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "delayed-reaction";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window just plays without a name. */
export const SIGN_IN_FROM = ["https://delayed-reaction.notryanquinn.workers.dev"];

export const { signIn, finishSignIn, login, signOut, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "delayed-reaction" });

/** Fills the menu's account row: the player's name and a way out, or a way in where eqosys can send them back. `note` is why the last sign-in failed. */
export function renderAccount(row: HTMLElement, note = ""): void {
  const button = (glyph: Parameters<typeof createElement>[0], label: string, go: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(createElement(glyph, { width: 18, height: 18 }));
    b.addEventListener("click", go);
    return b;
  };
  const who = login();
  const out: Node[] = [];
  if (who) {
    const name = document.createElement("span");
    name.className = "rider";
    name.textContent = who.name;
    out.push(name, button(LogOut, "Sign out", () => { signOut(); renderAccount(row); }));
  } else if (canSignIn()) out.push(button(LogIn, "Sign in", () => void signIn()));
  if (note) { const s = document.createElement("small"); s.textContent = note; out.push(s); }
  row.replaceChildren(...out);
}
