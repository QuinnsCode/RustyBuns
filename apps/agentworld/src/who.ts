// Who a request is from, on the server: the page sends its eqosys token (`Authorization: Bearer <token>`), and this
// checks it against eqosys's public keys for app `agentworld` (`checkerFor` in @rustybuns/util/token fetches them once
// an isolate and keeps them a few minutes). No platform here: the Worker's Galaxy and scripts/dev.ts both use it,
// each with its eqosys origin (EQOSYS_URL, or the live one). A token is never logged or sent on.
import { checkerFor, TOKEN } from "@rustybuns/util/token";

/** This app in eqosys's APPS (apps/eqosys/src/apps.ts), and where the live eqosys is. */
export const APP = "agentworld", EQOSYS = "https://eqosys.qntbr.com";

/** The person behind `req` as the server knows them, `eq:<sub>`, or null when it carries no good token for this app. */
export async function whoSent(req: Request, eqosys: string, now = Date.now()): Promise<string | null> {
  const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token || !TOKEN.test(token)) return null;
  const claims = await checkerFor(eqosys.replace(/\/$/, ""), APP).check(token, now).catch(() => null);
  return claims ? `eq:${claims.sub}` : null;
}
