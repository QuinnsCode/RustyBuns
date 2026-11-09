// Qollab's Worker: the paths in apps/eqosys/src/qollab/routes.ts and the objects behind them. eqosys hands every Qollab path
// here (its QOLLAB service binding), so the request still names eqosys's origin and a token still names eqosys as its issuer.
import { qollab } from "../../eqosys/src/qollab/routes.ts";
import { json, type Env } from "../../eqosys/src/env.ts";

export { Hub } from "../../eqosys/src/qollab/hub.ts";
export { Party } from "../../eqosys/src/qollab/party.ts";
export { Space } from "../../eqosys/src/qollab/space.ts";

// Under eqosys's `bun run dev` (vite runs this Worker beside it), the request's own origin is the issuer, as eqosys's dev server says.
const dev = (req: Request, env: Env): Env =>
  import.meta.env?.VITE_IS_DEV_SERVER ? { ...env, BETTER_AUTH_URL: new URL(req.url).origin, LOOPBACK_RETURNS: env.LOOPBACK_RETURNS ?? "1" } : env;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return (await qollab(req, dev(req, env))) ?? json({ error: "not a Qollab path" }, 404);
  },
};
