// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Splat Rooms has no server of its own that knows players (the edge build is a viewer shell and scenes
// live on the player's disk), so the sign-in gives the menu a name and nothing more: the token is kept
// for when a Worker wants it (check it with TokenChecker from @rustybuns/util/token).
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "splat-rooms";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. The desktop app and local pages keep playing as a guest. */
export const SIGN_IN_FROM = ["https://splat-rooms.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, signOut, canSignIn, reportButton } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "splat-rooms" });
