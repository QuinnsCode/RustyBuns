// hemyviz: your Alchemy deployments drawn live, in 2D, 2.5D and 3D. `bun src/main.ts` (or `bun run hemyviz` at the
// repo root) serves the page on 127.0.0.1 only: it reads state files, which name your resources.
//
//   --state <dir>   an Alchemy state dir to read (`.alchemy/state`); give it more than once. Without it: ./.alchemy/state
//                   and the repo's shared Rusty Buns state (every app, every stage, every worktree)
//   --demo          a made-up fleet instead (demo.ts)
//   --port <n|name> default PORTS.hemyviz (4798); taken, any free one
import { onPortOrFree, portArg } from "@rustybuns/util/ports";
import page from "./page.html";
import { api } from "./server.ts";
import { scan, stateDirsFor } from "./scan.ts";
import { demoFleet } from "./demo.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));
if (argv.includes("--help")) { console.log((await Bun.file(import.meta.path).text()).split("\nimport")[0]); process.exit(0); }

const dirs = stateDirsFor(process.cwd(), flag("--state"));
const read = argv.includes("--demo") ? demoFleet : () => scan(dirs);
const handle = api(read);
const { server, moved } = onPortOrFree(portArg(flag("--port")[0], "hemyviz"), (port) =>
  Bun.serve({ port, hostname: "127.0.0.1", routes: { "/": page, "/api/*": handle }, fetch: () => new Response("not found", { status: 404 }) }));

const f = read();
console.log(`hemyviz${moved ? " (its port was taken)" : ""}: ${server.url}`);
console.log(argv.includes("--demo") ? "  showing the demo fleet" : `  ${f.stacks.length} stack stages, ${f.stacks.reduce((n, s) => n + s.resources.length, 0)} resources from ${dirs.length} state dir${dirs.length === 1 ? "" : "s"}`);
