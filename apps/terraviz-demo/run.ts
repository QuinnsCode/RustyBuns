// TerraViz (github.com/zyra-project/terraviz, Apache-2.0, copyright The Zyra Project) on Rusty Buns, its code
// unchanged. The trial harness clones it, fetches its Git LFS images, runs `rustybuns init`, then builds and boots
// the desktop host in a sandbox. This then starts that host so you can look at it. No TerraViz file is kept in this
// repo: the clone lives in ~/rustybuns-demos/terraviz. Not inside this repo, where TypeScript in TerraViz's build
// would pick up our node_modules/@types (Bun's fetch type) and fail its own type check.
//
//   bun apps/terraviz-demo/run.ts            reuse the last clone if it built
//   bun apps/terraviz-demo/run.ts --fresh    clone TerraViz's latest again
import { $ } from "bun";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../..");
const OUT = join(homedir(), "rustybuns-demos/terraviz");
const clone = join(OUT, "clones/zyra-project__terraviz");

if (process.argv.includes("--fresh")) rmSync(OUT, { recursive: true, force: true });
if (!existsSync(join(clone, ".rustybuns/dev/desktop.js")))
  await $`bun scripts/trial-github.ts --local --keep --priority normal --out ${OUT} zyra-project/terraviz`.cwd(REPO);
if (!existsSync(join(clone, ".rustybuns/dev/desktop.js"))) {
  console.error(`TerraViz didn't build: ${join(OUT, "summary.md")} and ${join(OUT, "logs")} say why`);
  process.exit(1);
}

// The same sandbox the trial booted it in on macOS: no network but localhost, nothing under your home. The globe's
// imagery comes from NASA GIBS through your browser, which isn't sandboxed.
const sb = existsSync(join(OUT, "sandbox")) ? readdirSync(join(OUT, "sandbox")).find((f) => f.startsWith("rbtrial") && f.endsWith("-offline.sb")) : undefined;
const cmd = ["bun", ".rustybuns/dev/desktop.js"];
const host = Bun.spawn(sb ? ["sandbox-exec", "-f", join(OUT, "sandbox", sb), ...cmd] : cmd, {
  cwd: clone,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    PATH: process.env.PATH, TERM: process.env.TERM, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR,
    HOME: join(OUT, "home"),
    CLOUDFLARE_API_TOKEN: "rustybuns-trial-has-no-credentials", CLOUDFLARE_ACCOUNT_ID: "rustybuns-trial-no-account",
    RUSTYBUNS_NO_UPDATE_CHECK: "1", RB_NO_BROWSER: process.env.RB_NO_BROWSER,
  },
});
process.on("SIGINT", () => host.kill());
process.exit(await host.exited);
