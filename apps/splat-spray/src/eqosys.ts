// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to /api/match and /ws in place of the tab's uid, and the Worker checks it (edge/eqosys.ts).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "splat-spray";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://splat-spray.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, reportButton } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-spray" });

/** The query that says who this tab is: the eqosys token while it lasts, else the tab's own uid. */
export function whoQuery(uid: string): Record<string, string> {
  const signed = login();
  return signed && fresh(signed) ? { token: signed.token } : { uid };
}
