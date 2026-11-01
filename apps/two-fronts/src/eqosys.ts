// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Campaigns are played from secret seat links and have no player accounts, so the login is the name shown
// in the panel and nothing the Worker checks yet.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys's APPS. */
export const APP = "two-fronts";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. A local page or the desktop window stays a guest. */
export const SIGN_IN_FROM = ["https://two-fronts.notryanquinn.workers.dev"];

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "tf" });
