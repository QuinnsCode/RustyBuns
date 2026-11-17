// The real character() figures in a row on a plain floor, five people in different builds and clothes, for a look or a
// side-by-side shot while the people climb (#5009) tunes packages/models/src/character.ts:
//   bun packages/models/scratch/people/serve.ts
//   bun scripts/probe.ts --url http://localhost:<port>/ --js "__people.turn(30)" --shot people.png
import { help } from "../../../../scripts/help.ts";
import page from "./index.html";

help(import.meta.path);
const server = Bun.serve({ port: Number(process.env.PORT ?? 0), routes: { "/": page } });
console.log(`people on ${server.url}`);
