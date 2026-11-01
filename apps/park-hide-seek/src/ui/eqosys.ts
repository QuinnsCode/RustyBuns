// Park Hide & Seek's side of signing in through eqosys: the shared client (@rustybuns/util/eqosys) with this game's id.
// The token it keeps is what the Worker checks (src/edge/eqosys.ts).
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "../api.ts";

export type { Login } from "@rustybuns/util/eqosys";
export const { signIn, finishSignIn, login, fresh, signOut, eqosysUrl, canSignIn, report, reportButton } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "phs" });
