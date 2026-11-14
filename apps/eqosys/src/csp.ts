// eqosys's pages' Content-Security-Policy (worker.tsx). Only eqosys's own origin is reachable, except /spaces, whose voice
// channels open Qlave's signalling socket (QLAVE.md §2). Audio arrives over WebRTC and plays from a srcObject, which CSP
// doesn't govern, so Qlave's origin in connect-src is all voice needs.
import { qlaveUrl } from "./qollab/qlave.ts";

/** The policy, with `script` as script-src and `connect` as connect-src. The two Google Fonts hosts are the sign-in page's type (Login.tsx). */
export const pageCsp = (script: string, connect = "'self'") =>
  `default-src 'none'; img-src 'self'; script-src ${script}; connect-src ${connect}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'`;

/** /spaces' connect-src: eqosys, and Qlave's origin over https and its socket (http and ws for a local Qlave). */
export function spacesConnect(conf: { QLAVE_URL?: string }) {
  const q = new URL(qlaveUrl(conf)), ws = q.protocol === "http:" ? "ws:" : "wss:";
  return `'self' ${q.origin} ${ws}//${q.host}`;
}
