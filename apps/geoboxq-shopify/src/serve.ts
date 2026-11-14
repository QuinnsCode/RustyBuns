// The same wrapper on a plain Bun server, for a store that does not run Workers.
import { handle, type Env } from "./worker.ts";
import { PORTS } from "../../../packages/util/src/ports.ts";

Bun.serve({ port: Number(process.env.PORT ?? PORTS.geoboxqShopify), fetch: (req) => handle(req, process.env as Env) });
