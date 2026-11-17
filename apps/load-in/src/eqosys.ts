// Signing in through eqosys, and the Qollab party, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// Before anyone can sign in from your site, add the game on the eqosys Studio page (Add a game: this id, your site) and put
// that site in SIGN_IN_FROM. A page on localhost stays a guest unless the `load-in.eqosys` setting names a local eqosys.
import { eqosys } from "@rustybuns/util/eqosys";

/** This game's id in eqosys. */
export const APP = "load-in";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origins eqosys sends players back to: your deployed site, once eqosys lists it. */
export const SIGN_IN_FROM: string[] = [];

export type { Login, PartyMember } from "@rustybuns/util/eqosys";
const account = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: APP });
export const { finishSignIn, login, canSignIn, accountChip, who } = account;

let partyClient: ReturnType<typeof account.party> | undefined;
/** The page's one party client: eqosys seats a player once per party, so the page keeps one socket. */
export const party = () => (partyClient ??= account.party());
