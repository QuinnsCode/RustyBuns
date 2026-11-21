// The framework examples' check-up (#3341), every few days: for each apps/frameworks/<framework>-example, one line per step.
//
//   bun scripts/framework-check.ts [app ...] --binary      build the desktop binary, run the shared journey against it
//   bun scripts/framework-check.ts [app ...] --shots       a 640x400 picture (16:10, so a bare page still reads at thumbnail size) of the running page as the README thumbnail
//   bun scripts/framework-check.ts [app ...] --plan        `rustybuns plan --offline`: what a deploy would create (read only)
//
// No app names means every one in EXAMPLES. --binary compiles a ~100 MB binary per app, so it runs on Bob:
// `bun run builder run . bun scripts/framework-check.ts --binary`. --shots runs here (it needs this Mac's `sips` and
// writes docs/readme/<app>.jpg; run `bun run docs` after); it takes the light dev host, the same page the binary serves.
// Nothing deploys: live Workers are the owner's call. Exits 1 if any step failed.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "./help.ts";
import { appDir } from "./app-dirs.ts";
import { counterJourney, start, stop } from "./counter.ts";

// `spa`: the counter is a "use server" action. `page`: not on the counter contract (its own test is the journey),
// so the binary check is that it serves behind its token and the page says this. `edge: false`: desktop and box
// only (a node:http server), so no edge plan.
export const EXAMPLES: Record<string, { spa?: string; page?: string; edge?: false }> = {
  "hono-example": {}, "elysia-example": {}, "astro-example": {}, "react-router-example": {}, "sveltekit-example": {},
  "nuxt-example": {}, "solidstart-example": {}, "qwik-example": {}, "nextjs-example": {}, "tanstack-start-example": { page: "Rendered on the server from D1" },
  "svelte-spa-example": { spa: "src/actions/counter.ts" }, "vue-spa-example": { spa: "src/actions/counter.ts" },
  "solid-spa-example": { spa: "src/actions/counter.ts" }, "express-example": { edge: false },
};

const root = join(import.meta.dir, "..");
const cli = join(root, "packages/cli/src/index.ts");

async function run(cmd: string[], cwd: string): Promise<string> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
  if (await p.exited) throw new Error(`${cmd.slice(1, 4).join(" ")} failed:\n${(out + err).trim().split("\n").slice(-12).join("\n")}`);
  return out;
}

async function binary(app: string, dir: string): Promise<string> {
  const out = await run(["bun", cli, "build", "desktop"], dir);
  const bin = /^built (\S+)$/m.exec(out)?.[1];
  if (!bin) throw new Error(`build desktop printed no binary:\n${out.slice(-1000)}`);
  const { spa, page, edge } = EXAMPLES[app]!;
  if (page) await serves(dir, [join(dir, bin)], page);
  else await counterJourney(dir, { host: [join(dir, bin)], spa, edge });
  return `journey passed on ${bin} (${Math.round(Bun.file(join(dir, bin)).size / 1e6)} MB)`;
}

async function serves(dir: string, cmd: string[], text: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "framework-serves-"));
  const host = await start(dir, home, cmd);
  try {
    const bare = await fetch(host.url + "/");
    if (bare.status !== 403) throw new Error(`no token: HTTP ${bare.status}, want 403`);
    const html = (await (await fetch(host.url + "/", { headers: { cookie: host.cookie } })).text()).replaceAll("<!-- -->", "");
    if (!html.includes(text)) throw new Error(`the page doesn't say "${text}":\n${html.slice(0, 1000)}`);
  } finally {
    await stop(host);
    rmSync(home, { recursive: true, force: true });
  }
}

async function shot(app: string, dir: string): Promise<string> {
  await run(["bun", cli, "build", "desktop", "--dev"], dir);
  const home = mkdtempSync(join(tmpdir(), "framework-shot-"));
  const host = await start(dir, home);
  try {
    const png = join(home, "shot.png");
    // The host takes ?token= once and sets its cookie, the way the desktop window opens it.
    const seen = await run(["bun", join(root, "scripts/probe.ts"), "--url", host.url, `/?token=${host.cookie.split("=")[1]}`, "--size", "640x400", "--settle", "2000", "--shot", png, "--js", "document.title"], root);
    // An uncaught error is a broken page (the HTTP journey can't see it), so no thumbnail of it.
    const thrown = seen.split("\n").filter((l) => l.trim().startsWith("uncaught:"));
    if (thrown.length) throw new Error(`the page threw: ${thrown.map((l) => l.trim()).join("; ")}`);
    return (await run(["bun", join(root, "scripts/readme-shots.ts"), `${app}=${png}`], root)).trim();
  } finally {
    await stop(host);
    rmSync(home, { recursive: true, force: true });
  }
}

async function plan(app: string, dir: string): Promise<string> {
  if (EXAMPLES[app]!.edge === false) return "desktop and box only: no edge to plan";
  // A plan writes wrangler.jsonc where the app has none (the SPAs); a read-only check leaves the tree as it was.
  const wrangler = join(dir, "wrangler.jsonc"), had = existsSync(wrangler);
  const out = await run(["bun", cli, "plan", "--offline"], dir).finally(() => { if (!had) rmSync(wrangler, { force: true }); });
  const made = out.split("\n").filter((l) => /^\s+\+ /.test(l)).map((l) => l.trim().slice(2).replace(/\s+/g, " "));
  const billed = out.split("\n").filter((l) => /\s(usage|free|\$)/.test(l) && /^\s{2}\S/.test(l)).map((l) => l.trim().replace(/\s{2,}/g, ": "));
  return `creates ${made.join(", ") || "nothing"}${billed.length ? `; billed by ${billed.join("; ")}` : ""}`;
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const steps: Record<string, (app: string, dir: string) => Promise<string>> = { binary, shots: shot, plan };
  const picked = Object.keys(steps).filter((s) => args.includes(`--${s}`));
  const apps = args.filter((a) => !a.startsWith("--"));
  const bad = apps.filter((a) => !(a in EXAMPLES));
  if (!picked.length || bad.length) {
    console.error(bad.length ? `not a framework example: ${bad.join(", ")} (EXAMPLES: ${Object.keys(EXAMPLES).join(", ")})` : "pick a step: --binary, --shots or --plan");
    process.exit(2);
  }
  let failed = 0;
  for (const app of apps.length ? apps : Object.keys(EXAMPLES)) {
    for (const s of picked) {
      const line = await steps[s]!(app, join(root, appDir(app, root))).then((r) => `ok   ${r}`, (e: Error) => { failed++; return `FAIL ${e.message}`; });
      console.log(`${app} ${s}: ${line}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
