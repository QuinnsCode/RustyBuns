// The pages' Content-Security-Policy (worker.tsx sets it on every page). Sockets and fetches stay on eqosys's own origin,
// except /spaces: its voice channels open Qlave's signalling socket (@rustybuns/util/voice), so that page alone may also
// reach Qlave's origin. Voice plays through <audio srcObject>, which media-src doesn't govern, so nothing else opens up.
import { qlaveUrl } from "./qollab/qlave.ts";

/** The policy for the page at `path`; `scripts` is its script-src (the theme script's hash and the module's nonce). */
export function pageCsp(path: string, scripts: string, conf: { QLAVE_URL?: string }) {
  let connect = "'self'";
  if (path === "/spaces") {
    const q = new URL(qlaveUrl(conf));
    connect += ` ${q.protocol === "http:" ? "ws:" : "wss:"}//${q.host} ${q.origin}`;
  }
  return `default-src 'none'; img-src 'self'; script-src ${scripts}; connect-src ${connect}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'`;
}
