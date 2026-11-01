// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps rides to the online /ws in place of the browser-made uid, and the Worker checks it (src/eqosys.ts).
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "../eqosys.ts";

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, canSignIn, reportButton } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "hippo" });
