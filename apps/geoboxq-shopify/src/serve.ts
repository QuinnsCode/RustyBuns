// The same wrapper on a plain Bun server, for a store that does not run Workers.
import { handle, type Env } from "./worker.ts";

Bun.serve({ port: Number(process.env.PORT ?? 8788), fetch: (req) => handle(req, process.env as Env) });
