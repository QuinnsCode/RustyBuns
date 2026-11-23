// The human() figures in a row on a plain floor, one of each build, for a look or a shot while the body, the faces and
// the walk are tuned (packages/models/src/human.ts):
//   bun packages/models/scratch/humans/serve.ts
//   bun scripts/probe.ts --url http://localhost:<port>/ --js "__humans.turn(30)" --shot humans.png
// `window.__humans`: state(), turn(deg) (0 faces the camera), view("row" | "close" | "one" | "side"), only(names or builds), paint(palette),
// move({ speed, crouch, heading, pitch, aim, down }), freeze(phase) (hold the stride at 0 to 1; null lets it run),
// outfit({ top, hair, hat, pack }), plain(true) (grey bodies, no clothes colour).
import { help } from "../../../../scripts/help.ts";
import page from "./index.html";

help(import.meta.path);
const server = Bun.serve({ port: Number(process.env.PORT ?? 0), routes: { "/": page } });
console.log(`humans on ${server.url}`);
