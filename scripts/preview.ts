// A preview of one PR, on demand (#2238): nothing deploys by default; this is "now make me this".
// Run it from the PR's worktree, on the owner's Mac (it deploys with this machine's Cloudflare login).
//
//   bun run preview <app>            deploy apps/<app> as stage pr-<n> (n is this branch's PR), post or edit one PR comment with the URL
//   bun run preview <app> --pr 4801  name the PR yourself
//   bun run preview --off [--pr n]   destroy that PR's preview and say so in its comment
//   bun run preview --sweep          destroy every preview whose PR closed or that is older than 3 days
//   bun run preview --list           the live previews, one line each
//
// Running it again on a PR that has a preview refreshes it (a new push, a new deploy) and never makes a second one.
// At most 5 are live at once; past that it refuses and names them. Stage pr-<n> is EPHEMERAL (`--ephemeral`, so a
// stage that would touch real data is refused), and `rustybuns destroy --stage pr-<n>` removes all of it.
// The live list is a small file in the repo's shared git dir (every worktree sees it), not the Alchemy state.
// The CI version (a /preview comment) waits on shared state, #2237, and a CI token: notes/ALCHEMY_PREVIEWS.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { arr, num, obj, oneOf, str, type Of } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

export const CAP = 5, TTL_MS = 3 * 24 * 3600_000, MARK = "<!-- rustybuns-preview -->";

export const Live = obj({ pr: num(1, 1e9), app: str(100), stage: str(100), url: str(400, { min: 0, dflt: "" }), at: num(0, 1e15) });
export type Live = Of<typeof Live>;
const Ledger = arr(Live, 1000, { drop: true });

export const stageOf = (pr: number) => `pr-${pr}`;

/** What a deploy for `pr` does given the live list: refresh its own, make a new one, or refuse at the cap. */
export function decide(live: Live[], pr: number, cap = CAP): { do: "refresh" | "create" } | { do: "refuse"; why: string } {
  if (live.some((l) => l.pr === pr)) return { do: "refresh" };
  if (live.length < cap) return { do: "create" };
  return { do: "refuse", why: `${live.length} previews are live (cap ${cap}): ${live.map((l) => `#${l.pr} ${l.app}`).join(", ")}. Take one down with \`bun run preview --off --pr <n>\`, or \`--sweep\`.` };
}

/** The previews a sweep takes down: their PR is no longer open, or they are older than the TTL. */
export function stale(live: Live[], states: Record<number, string>, now = Date.now(), ttl = TTL_MS): Live[] {
  return live.filter((l) => (states[l.pr] ?? "OPEN") !== "OPEN" || now - l.at > ttl);
}

/** The last https URL in a deploy's output: the stack's `url` output, printed at the end. */
export function lastUrl(out: string): string | null {
  const all = out.replace(/\x1b\[[0-9;]*m/g, "").match(/https:\/\/[^\s"'`<>)\]]+/g);
  return all?.length ? all[all.length - 1]!.replace(/[.,;:]+$/, "") : null;
}

/** The one PR comment, marked so the next run edits it in place. */
export function commentBody(l: Live | null, note: string): string {
  if (!l) return `${MARK}\n**Preview:** none live. ${note}`;
  const until = new Date(l.at + TTL_MS).toISOString().slice(0, 16).replace("T", " ");
  return `${MARK}\n**Preview** of \`${l.app}\` (stage \`${l.stage}\`): ${l.url || "deployed, URL not found in the output"}\n\n` +
    `Updated ${new Date(l.at).toISOString().slice(0, 16).replace("T", " ")} UTC; taken down when the PR closes (on the next \`bun run preview --sweep\`) or after ${until} UTC. ${note}`.trim();
}

// ---- the parts that touch the world ----

const Comments = arr(obj({ id: num(1, 1e15), body: str(70_000, { min: 0, dflt: "" }) }), 10_000, { drop: true });
const PrState = obj({ number: num(1, 1e9), state: oneOf(["OPEN", "CLOSED", "MERGED"]) });

function sh(cmd: string[], o: { cwd?: string; input?: string } = {}): string {
  const p = Bun.spawnSync(cmd, { cwd: o.cwd, stdin: o.input === undefined ? "ignore" : new TextEncoder().encode(o.input), stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} failed: ${p.stderr.toString().trim().split("\n").slice(-3).join(" ")}`);
  return p.stdout.toString();
}

const root = () => sh(["git", "rev-parse", "--show-toplevel"]).trim();
const ledgerFile = () => join(resolve(sh(["git", "rev-parse", "--git-common-dir"]).trim()), "rustybuns-previews.json");
// A guard called directly throws on the wrong shape: a broken list or reply stops the run rather than guessing.
const readLedger = (f: string): Live[] => existsSync(f) ? Ledger(JSON.parse(readFileSync(f, "utf8"))) : [];
const writeLedger = (f: string, l: Live[]) => writeFileSync(f, JSON.stringify(l, null, 2) + "\n");

const prHere = () => PrState(JSON.parse(sh(["gh", "pr", "view", "--json", "number,state"]))).number;
const prState = (n: number) => PrState(JSON.parse(sh(["gh", "pr", "view", String(n), "--json", "number,state"]))).state;

/** Post the marked comment, or edit the one already there. */
function comment(pr: number, body: string) {
  const pages = arr(Comments, 1000)(JSON.parse(sh(["gh", "api", "--paginate", "--slurp", `repos/{owner}/{repo}/issues/${pr}/comments`])));
  const mine = pages.flat().find((c) => c.body.startsWith(MARK));
  const input = JSON.stringify({ body });
  if (mine) sh(["gh", "api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${mine.id}`, "--input", "-"], { input });
  else sh(["gh", "api", "-X", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "--input", "-"], { input });
}

/** `rustybuns <sub> --stage pr-<n>` in the app, its output shown as it runs and kept. */
async function rustybuns(appDir: string, args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(["bunx", "rustybuns", ...args], { cwd: appDir, stdin: "inherit", stdout: "pipe", stderr: "inherit" });
  let out = "";
  for await (const chunk of p.stdout) { const s = new TextDecoder().decode(chunk); out += s; process.stdout.write(s); }
  return { code: await p.exited, out };
}

async function takeDown(l: Live, why: string): Promise<boolean> {
  const dir = join(root(), "apps", l.app);
  const { code } = await rustybuns(dir, ["destroy", "--stage", l.stage, "--ephemeral", "--yes"]);
  if (code !== 0) { console.error(`destroy of ${l.stage} (${l.app}) failed; it stays on the list`); return false; }
  try { comment(l.pr, commentBody(null, why)); } catch (e) { console.error(`note: couldn't edit #${l.pr}'s comment: ${(e as Error).message}`); }
  return true;
}

async function main(argv: string[]) {
  help(import.meta.path, argv);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const prArg = flag("pr"), file = ledgerFile();
  let live = readLedger(file);

  if (argv.includes("--list")) {
    console.log(live.length ? live.map((l) => `#${l.pr} ${l.app} ${l.stage} ${l.url || "-"} ${new Date(l.at).toISOString().slice(0, 16)}`).join("\n") : "no previews live");
    return;
  }
  if (argv.includes("--sweep")) {
    const states = Object.fromEntries(live.map((l) => [l.pr, prState(l.pr)]));
    const gone = stale(live, states);
    for (const l of gone) {
      const why = states[l.pr] !== "OPEN" ? `The PR is ${states[l.pr]!.toLowerCase()}.` : "It was older than 3 days; run `bun run preview` again for a new one.";
      if (await takeDown(l, why)) { live = live.filter((x) => x.pr !== l.pr); writeLedger(file, live); }
    }
    console.log(`swept ${gone.length}, ${live.length} live`);
    return;
  }
  const pr = prArg ? num(1, 1e9)(Number(prArg)) : prHere();
  if (argv.includes("--off")) {
    const l = live.find((x) => x.pr === pr);
    if (!l) { console.log(`#${pr} has no preview live`); return; }
    if (await takeDown(l, "Taken down by hand.")) writeLedger(file, live.filter((x) => x.pr !== pr));
    return;
  }
  const app = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--pr");
  if (!app || !/^[a-z0-9-]+$/.test(app)) throw new Error("name the app: bun run preview <app>   (--help for the rest)");
  const appDir = join(root(), "apps", app);
  if (!existsSync(join(appDir, "rustybuns.config.ts"))) throw new Error(`apps/${app} has no rustybuns.config.ts, so there is nothing to deploy`);
  const d = decide(live, pr);
  if (d.do === "refuse") throw new Error(d.why);
  const stage = stageOf(pr);
  const { code, out } = await rustybuns(appDir, ["deploy", "--stage", stage, "--ephemeral", "--yes"]);
  if (code !== 0) throw new Error(`deploy of ${app} as ${stage} failed (exit ${code}); nothing posted`);
  const entry: Live = { pr, app, stage, url: lastUrl(out) ?? "", at: Date.now() };
  writeLedger(file, [...live.filter((l) => l.pr !== pr), entry]);
  comment(pr, commentBody(entry, d.do === "refresh" ? "Refreshed from the latest push." : ""));
  console.log(`\npreview ${d.do === "refresh" ? "refreshed" : "up"}: #${pr} ${entry.url || "(no URL in the output)"}`);
}

if (import.meta.main) await main(process.argv.slice(2)).catch((e) => { console.error(`preview: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
