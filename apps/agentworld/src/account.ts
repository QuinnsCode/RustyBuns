// "Create your world": signing in through eqosys (@rustybuns/util/eqosys, as Park Hide & Seek does) and opening your
// world. Signed in, the page sends its token (`bearer`) and the server keeps one world per person (POST /api/me/world,
// galaxy.ts): the first room you sign in from, whichever browser you come back on. eqosys sends a person back to the
// site's root (`/`, its APPS row's default return), so signing in leaves from there and main.ts opens their world.
import { eqosys } from "@rustybuns/util/eqosys";
import { getJson } from "@rustybuns/util/http";
import { MyWorld } from "./galaxy.ts";
import { APP, EQOSYS } from "./who.ts";

/** The site eqosys sends people back to. */
export const SIGN_IN_FROM = ["https://agentworld.notryanquinn.workers.dev"];

export const { signIn, finishSignIn, login, fresh, ready, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "agentworld" });

/** The room this browser keeps as the person's own world. */
const MINE = "agentworld:mine";
export const mine = (): string | null => { try { return localStorage.getItem(MINE); } catch { return null; } };
const keepMine = (room: string) => { try { localStorage.setItem(MINE, room); } catch { /* private window: this visit only */ } };

/** The `Authorization` header for the server, once the kept login has a token with a few seconds left; else none. */
export async function bearer(): Promise<Record<string, string>> {
  await ready;
  const l = login();
  return l && fresh(l, 5_000) ? { authorization: `Bearer ${l.token}` } : {};
}

/** Your world as the server keeps it: `room` the first time you ask, that first room ever after. Null when signed
 *  out or the server can't be reached. */
export async function myWorld(room: string): Promise<string | null> {
  const auth = await bearer();
  if (!auth.authorization) return null;
  const got = await getJson("/api/me/world", MyWorld, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ room }) });
  if (got) keepMine(got.room);
  return got?.room ?? null;
}

/** What the "Create your world" card did: opened the world here, went off to eqosys or to your world, or found no sign-in. */
export type Created = "here" | "away" | "off";

/** The card, pressed in `room`. Signed in: your world (this browser's, or this one, the first time). Signed out: off
 *  to eqosys, from the root. */
export async function createWorld(room: string): Promise<Created> {
  if (login()) {
    const world = (await myWorld(mine() ?? room)) ?? mine() ?? room;
    keepMine(world);
    if (world !== room) { location.assign(`/r/${world}`); return "away"; }
    return "here";
  }
  if (!canSignIn()) return "off";
  // The room you are in becomes your world when you're back, unless your account has one already.
  keepMine(room);
  history.replaceState(null, "", "/");
  void signIn("create");
  return "away";
}

/** Back from eqosys (a `/?code=&state=` address): your world to open, signed in, or null when this isn't a return. */
export async function backFromSignIn(): Promise<string | null> {
  if (!new URLSearchParams(location.search).has("state")) return null;
  const back = await finishSignIn();
  if (!back?.login || back.then !== "create") return null;
  const here = mine();
  return here ? ((await myWorld(here)) ?? here) : null;
}
