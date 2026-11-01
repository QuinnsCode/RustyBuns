// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Online, the token it keeps rides to /ws in place of the tab's uid, and the Worker checks it (edge/eqosys.ts).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "git-recon";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A LAN battle, a local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://git-recon.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "git-recon" });
