// TerraViz (github.com/zyra-project/terraviz, Apache-2.0, copyright The Zyra Project) on Rusty Buns, its code
// unchanged. The trial harness clones it, fetches its Git LFS images, runs `rustybuns init`, then builds and boots
// the desktop host in a sandbox. This then starts that host so you can look at it. No TerraViz file is kept in this
// repo: the clone lives in ~/rustybuns-demos/terraviz. Not inside this repo, where TypeScript in TerraViz's build
// would pick up our node_modules/@types (Bun's fetch type) and fail its own type check.
//
//   bun apps/terraviz-demo/run.ts            reuse the last clone if it built
//   bun apps/terraviz-demo/run.ts --fresh    clone TerraViz's latest again
//   bun apps/terraviz-demo/run.ts --shared   the same, plus Shared Sphere (sphere/): everyone on one globe
//   bun apps/terraviz-demo/run.ts --shared --binary   build the one-file Shared Sphere desktop app and print where it is
//   bun apps/terraviz-demo/run.ts --port 4710         a fixed port (and RB_TOKEN a fixed launch token), for a test or a second window
//   bun apps/terraviz-demo/run.ts --down     tear it all down: the clone, its data, its sandbox and logs
// With --shared, a link can land in a state: add ?dataset=<id>&lon=&lat=&zoom=&bearing=&pitch=&lead=1&tour=<name> to the
// page's address, or call window.sphere.jump({ dataset, lon, lat, zoom, lead, tour }) from the console or an agent's browser.
// A teacher's link adds &teach=<word>: the room then follows only them.
import { $ } from "bun";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { linkRustybuns } from "./sphere/stage.ts";

const REPO = resolve(import.meta.dir, "../..");
const OUT = join(homedir(), "rustybuns-demos/terraviz");
const clone = join(OUT, "clones/zyra-project__terraviz");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };

if (args.includes("--down")) {
  if (existsSync(OUT)) { rmSync(OUT, { recursive: true, force: true }); console.log(`removed ${OUT}`); }
  else console.log(`nothing at ${OUT}`);
  process.exit(0);
}
if (args.includes("--fresh")) rmSync(OUT, { recursive: true, force: true });
if (!existsSync(join(clone, ".rustybuns/dev/desktop.js")))
  await $`bun scripts/trial-github.ts --local --keep --priority normal --out ${OUT} zyra-project/terraviz`.cwd(REPO);
if (!existsSync(join(clone, ".rustybuns/dev/desktop.js"))) {
  console.error(`TerraViz didn't build: ${join(OUT, "summary.md")} and ${join(OUT, "logs")} say why`);
  process.exit(1);
}

// Shared Sphere builds its own host file beside the plain one. The clone links @rustybuns/* to whichever checkout ran
// the trial, which may be gone (an agent's worktree), so point them at this one first.
const shared = args.includes("--shared");
const binary = args.includes("--binary");
let hostFile = ".rustybuns/dev/desktop.js";
if (shared) {
  linkRustybuns(clone, REPO);
  await $`bun ${join(import.meta.dir, "sphere/build.ts")} ${binary ? ["--compile"] : []}`.cwd(clone);
  if (binary) {
    console.log(`That is the Shared Sphere desktop app, in ${clone}. Double-click it or run it; it opens the browser.`);
    console.log("It carries TerraViz's code: its LICENSE and NOTICE go with it if it leaves this machine (see the README).");
    process.exit(0);
  }
  hostFile = ".rustybuns/sphere-dev/desktop.js";
  console.log("Shared Sphere: open the link in two windows (or add ?room=name&name=you), then press Lead in one");
  console.log("Teach a class: add ?room=class-7b&teach=apple to your link and give the class ?room=class-7b. Only you lead.");
  console.log("Jump to a state: add ?dataset=sea-surface-temperature&lon=139.7&lat=35.7&zoom=3&lead=1 or ?tour=three-places (any of them) to the link");
}

// The trial's macOS sandbox, in its "net" form: nothing under your home but the demo folder, and the network open,
// because the globe's imagery comes from NASA GIBS through TerraViz's own /api/tile proxy in the Worker. The offline
// profile the trial boots with turns every tile into a 502 and the page never leaves "Loading Earth textures".
const profiles = existsSync(join(OUT, "sandbox")) ? readdirSync(join(OUT, "sandbox")).filter((f) => f.startsWith("rbtrial")) : [];
const sb = profiles.find((f) => f.endsWith("-net.sb")) ?? profiles.find((f) => f.endsWith("-offline.sb"));
const port = flag("port");
const cmd = ["bun", hostFile];
const host = Bun.spawn(sb ? ["sandbox-exec", "-f", join(OUT, "sandbox", sb), ...cmd] : cmd, {
  cwd: clone,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    PATH: process.env.PATH, TERM: process.env.TERM, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR,
    HOME: join(OUT, "home"),
    CLOUDFLARE_API_TOKEN: "rustybuns-trial-has-no-credentials", CLOUDFLARE_ACCOUNT_ID: "rustybuns-trial-no-account",
    RUSTYBUNS_NO_UPDATE_CHECK: "1", RB_NO_BROWSER: process.env.RB_NO_BROWSER,
    // a fixed port and launch token, so a test or a second window knows where to find it
    RB_LISTEN: port ? `127.0.0.1:${port}` : process.env.RB_LISTEN, RB_TOKEN: process.env.RB_TOKEN,
  },
});
// Ctrl-C, or a test or the office stopping this: the host goes too, never orphaned on its port
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => host.kill());
process.exit(await host.exited);
