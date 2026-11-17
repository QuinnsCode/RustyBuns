// The people climb's three mock figures (#5009 round 2), served on a free port for a look or a shot:
//   bun packages/models/scratch/people-mocks/serve.ts
//   bun scripts/probe.ts --url http://localhost:<port>/ --js "__mocks.turn(30)" --shot mocks.png
// A scratch harness: the owner picks a direction from it, then packages/models/src/character.ts is reworked around it.
import { help } from "../../../../scripts/help.ts";
import page from "./index.html";

help(import.meta.path);
const server = Bun.serve({ port: Number(process.env.PORT ?? 0), routes: { "/": page } });
console.log(`people mocks on ${server.url}`);
