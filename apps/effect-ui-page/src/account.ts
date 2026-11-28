// "Create your world": signing in through eqosys (@rustybuns/util/eqosys, as Park Hide & Seek does) and opening the
// world this browser keeps. Client side only: who is signed in stays in this browser, and nothing on a server maps a
// person to their plot yet. eqosys sends a person back to the site's root (`/`, its APPS row's default return), so
// signing in leaves from there and main.ts opens their world when they're back.
import { eqosys } from "@rustybuns/util/eqosys";

/** This app in eqosys's APPS (apps/eqosys/src/apps.ts), where eqosys is, and the site it sends people back to. */
export const APP = "agent-page", EQOSYS = "https://eqosys.qntbr.com";
export const SIGN_IN_FROM = ["https://agent-page.notryanquinn.workers.dev"];

export const { signIn, finishSignIn, login, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "agent-page" });

/** The room this browser keeps as the person's own world. */
const MINE = "agent-page:mine";
export const mine = (): string | null => { try { return localStorage.getItem(MINE); } catch { return null; } };
const keepMine = (room: string) => { try { localStorage.setItem(MINE, room); } catch { /* private window: this visit only */ } };

/** What the "Create your world" card did: opened the world here, went off to eqosys or to the kept room, or found no sign-in. */
export type Created = "here" | "away" | "off";

/** The card, pressed in `room`. Signed in: the kept room, or this one becomes it. Signed out: off to eqosys, from the root. */
export function createWorld(room: string): Created {
  if (login()) {
    const kept = mine();
    if (kept && kept !== room) { location.assign(`/r/${kept}`); return "away"; }
    keepMine(room);
    return "here";
  }
  if (!canSignIn()) return "off";
  if (!mine()) keepMine(room);
  history.replaceState(null, "", "/");
  void signIn("create");
  return "away";
}

/** Back from eqosys (a `/?code=&state=` address): the room to open, signed in, or null when this isn't a return. */
export async function backFromSignIn(): Promise<string | null> {
  if (!new URLSearchParams(location.search).has("state")) return null;
  const back = await finishSignIn();
  if (!back?.login || back.then !== "create") return null;
  return mine();
}
