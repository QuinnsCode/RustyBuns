// Releases: every app inside RustyBuns in a row, then every QuinnsCode repo, busiest first. A dot for where it stands
// (green live, red error, yellow testing and not released yet, grey a code example only), the PRs merged today and
// this week, and its prod link. RustyBuns' apps come from the bridge's scan (scripts/bridge.ts: live pings, release
// tags, hourly CI); the other repos from gh (homepage as the prod link, the default branch's last run). Which apps are
// code only is CODE_ONLY in scripts/releases-lib.ts.
//
//   bun run releases                  print the rows
//   bun run releases --html out.html  write the page (publish it as the releases artifact)
//   bun run releases --json           print the data
//   bun run releases --publish        write ~/.rustybuns/releases/releases.html and have a headless Claude republish it
//                                     to the releases artifact (same URL; artifacts have no API, only Claude's tools)
//   bun run releases --install        a launchd job on the office Mac: --publish at :17 past every hour 7am to 10pm,
//                                     log in ~/.rustybuns/releases/releases.log (--uninstall takes it off). It runs from its
//                                     own detached checkout at ~/.rustybuns/releases/rustybuns, made on the first install,
//                                     and each --publish there first moves it to origin/main
//   bun run releases --rerelease      the page's "To re-release" list (live apps main moved since their last deploy from
//                                     this Mac): one at a time, asks, plans a rustybuns deploy, asks again, deploys. Run
//                                     it from that job checkout (it follows main); the hourly --publish waits meanwhile
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { help } from "./help.ts";
import { appDir } from "./app-dirs.ts";
import { catchUp, headless, install, jobCheckout, uninstall } from "./launchd.ts";
import { esc } from "../packages/util/src/index.ts";
import { arr, bool, obj, opt, str } from "../packages/util/src/guard.ts";
import { ping, scan } from "./bridge.ts";
import { lastDeploys } from "./bridge-lib.ts";
import { DEPLOY_LOG } from "../packages/cli/src/report-deploy.ts";
import { appDot, appOfPath, busiest, deployOf, hasState, owed, pacific, repoDot, stateDirs, tally, type Counts, type Dot } from "./releases-lib.ts";
import { sharedStateBase } from "../packages/cli/src/state.ts";

const OWNER = "QuinnsCode", HOME = "RustyBuns";
const ARTIFACT = "https://claude.ai/artifact/EFQKb3WEiu7c5X9GURb8ch"; // QNTBR Releases (#5237)
const LABEL = "com.rustybuns.releases";
const dir = path.join(homedir(), ".rustybuns", "releases");
const file = path.join(dir, "releases.html");
const repo = path.resolve(import.meta.dir, "..");

/** `deployed` is its newest deploy from this Mac (~/.rustybuns/deploys.jsonl); `owed` means main moved it since, and
 *  `deploy` is how it goes out again (`dir` is its folder). Repos other than RustyBuns have none of these. */
export type Row = Counts & { name: string; dot: Dot; why: string; link: string | null; code: string; pushed: string | null;
  id: string | null; dir: string | null; deployed: string | null; owed: boolean; deploy: { plan: boolean; cmd: string } | null };
export type Releases = { at: string; repos: Row[]; apps: Row[] };

async function gh<T>(args: string[], g: (v: unknown) => T, fallback: T): Promise<T> {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) return fallback;
  try { return g(JSON.parse(out)); } catch { return fallback; }
}

const Repos = arr(obj({ name: str(200), url: str(500), homepageUrl: opt(str(500, { min: 0, dflt: "" })), isArchived: bool(), isFork: bool(), pushedAt: str(40), defaultBranchRef: opt(obj({ name: str(200) })) }), 1000, { drop: true });
const Found = arr(obj({ repository: obj({ name: str(200) }), closedAt: str(40) }), 1000);
const Merged = arr(obj({ mergedAt: str(40), files: arr(obj({ path: str(500) }), 5000, { drop: true }) }), 1000);
const Runs = arr(obj({ conclusion: str(40, { min: 0, dflt: "" }), status: str(40) }), 5);

const Pkg = obj({ scripts: opt(obj({ deploy: opt(str(2000)) })) });
/** An app's own `deploy` script from its package.json, or null. */
function deployScript(folder: string): string | null {
  try { return Pkg(JSON.parse(readFileSync(path.join(repo, folder, "package.json"), "utf8"))).scripts?.deploy ?? null; } catch { return null; }
}

const say: Record<Dot, string> = { live: "Live", error: "Error", testing: "Testing, not released", code: "Code example only" };
const linkOf = (u: string | null | undefined) => !u || /github\.com/.test(u) ? null : /^https?:\/\//.test(u) ? u : `https://${u}`;

export async function releases(now = new Date()): Promise<Releases> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [bridge, repos, found, merged] = await Promise.all([
    scan(),
    gh(["repo", "list", OWNER, "--limit", "1000", "--json", "name,url,homepageUrl,isArchived,isFork,pushedAt,defaultBranchRef"], Repos, []),
    gh(["search", "prs", "--owner", OWNER, "--merged-at", `>=${since}`, "--limit", "1000", "--json", "repository,closedAt"], Found, []),
    gh(["pr", "list", "-R", `${OWNER}/${HOME}`, "--state", "merged", "--search", `merged:>=${since}`, "--limit", "1000", "--json", "mergedAt,files"], Merged, []),
  ]);

  const perApp = tally(merged, (p) => p.files.map((f) => appOfPath(f.path)).filter((x): x is string => !!x), now);
  const apps = bridge.apps.map((a): Row => {
    const dot = appDot({ id: a.id, link: a.play, live: a.live, light: a.light, releaseOk: a.release?.ok ?? null, released: !!a.good });
    const why = dot === "error" ? (a.live && !a.live.ok ? `prod link answered ${a.live.status || "nothing"}` : a.release?.ok === false ? `release ${a.release.tag} failed` : "hourly tests failed")
      : dot === "live" ? (a.good && !a.play ? `released ${a.good.tag}` : "prod link answers") : dot === "code" ? say.code : a.play ? "prod link not checked" : "no prod deploy yet";
    const link = a.id === "rustybuns" ? "https://www.npmjs.com/package/rustybuns" : a.play;
    const folder = a.id === "rustybuns" ? "packages" : appDir(a.id), pushed = a.commit?.at ?? null, deployed = a.deploy?.at ?? null;
    return { name: a.name, dot, why, link, pushed, code: `https://github.com/${OWNER}/${HOME}/tree/main/${folder}`, ...(perApp.get(a.id) ?? { today: 0, week: 0 }),
      id: a.id, dir: folder, deployed, owed: owed({ id: a.id, link, dot, pushed, deployed }), deploy: deployOf(a.id, deployScript(folder)) };
  });

  const perRepo = tally(found.map((f) => ({ mergedAt: f.closedAt, repo: f.repository.name })), (p) => [p.repo], now);
  perRepo.set(HOME, tally(merged, () => [HOME], now).get(HOME) ?? { today: 0, week: 0 });
  const framework = apps.find((a) => a.code.endsWith("/packages"));
  const rows = await Promise.all(repos.filter((r) => !r.isFork).map(async (r): Promise<Row> => {
    const counts = perRepo.get(r.name) ?? { today: 0, week: 0 };
    if (r.name === HOME && framework) {
      const broken = apps.filter((a) => a.dot === "error").length;
      return { ...framework, ...counts, name: HOME, code: r.url, pushed: r.pushedAt, dot: broken ? "error" : framework.dot, why: broken ? `${broken} app${broken > 1 ? "s" : ""} in error` : `framework ${framework.why}` };
    }
    const daysQuiet = (now.getTime() - Date.parse(r.pushedAt)) / 86_400_000;
    const link = linkOf(r.homepageUrl);
    const [live, run] = await Promise.all([
      link && !r.isArchived ? ping(link) : null,
      daysQuiet <= 30 && r.defaultBranchRef ? gh(["run", "list", "-R", `${OWNER}/${r.name}`, "--branch", r.defaultBranchRef.name, "--limit", "1", "--json", "conclusion,status"], Runs, []) : [],
    ]);
    const lastRun = run[0]?.status === "completed" ? run[0].conclusion : null;
    const dot = repoDot({ archived: r.isArchived, link, live, lastRun, daysQuiet });
    const why = r.isArchived ? "archived" : dot === "error" ? (live && !live.ok ? `prod link answered ${live.status || "nothing"}` : "last run on main failed")
      : dot === "live" ? "prod link answers" : dot === "testing" ? `pushed ${Math.floor(daysQuiet)}d ago, no prod link` : "no prod link, quiet";
    return { name: r.name, dot, why, link, pushed: r.pushedAt, code: r.url, ...counts, id: null, dir: null, deployed: null, owed: false, deploy: null };
  }));
  return { at: now.toISOString(), repos: busiest(rows), apps: busiest(apps) };
}

// ---- the page -----------------------------------------------------------------------------------

const at = (iso: string | null, none = "never") => iso ? esc(pacific(iso)) : `<span class="none">${none}</span>`;

function table(rows: Row[], id: string, deploys = false) {
  const tr = (r: Row) => `<tr class="d-${r.dot}">
    <td class="who"><span class="dot" title="${esc(say[r.dot])}: ${esc(r.why)}"></span><a href="${esc(r.code)}">${esc(r.name)}</a><small>${esc(r.why)}</small></td>
    <td class="n${r.today ? "" : " zero"}">${r.today}</td><td class="n${r.week ? "" : " zero"}">${r.week}</td>
    <td class="when">${at(r.pushed)}</td>
    ${deploys ? `<td class="when${r.owed ? " owed" : ""}">${r.link && r.id !== "rustybuns" ? at(r.deployed, "not logged") : `<span class="none">-</span>`}</td>` : ""}
    <td class="prod">${r.link ? `<a href="${esc(r.link)}">${esc(r.link.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : `<span class="none">none</span>`}</td></tr>`;
  return `<div class="scroll"><table id="${id}"><thead><tr><th>Status</th><th class="n">PRs today</th><th class="n">PRs this week</th><th>Last push</th>${deploys ? "<th>Last deploy</th>" : ""}<th>Prod link</th></tr></thead><tbody>${rows.map(tr).join("")}</tbody></table></div>`;
}

/** The live apps main has moved since their last deploy, each with the line that ships it again from its folder. */
function owedList(rows: Row[]) {
  const owe = rows.filter((r) => r.owed);
  if (!owe.length) return `<p class="clear">Every live app is deployed up to main.</p>`;
  const li = (r: Row) => `<li><b>${esc(r.name)}</b><span class="when">merged ${at(r.pushed)} · deployed ${at(r.deployed, "not logged")}</span>
    <code>${r.deploy ? `cd ${esc(r.dir ?? "")} &amp;&amp; ${r.deploy.plan ? "bunx rustybuns plan &amp;&amp; " : ""}${esc(r.deploy.cmd)}` : "no deploy script"}</code></li>`;
  return `<p class="how">Run <code>bun ~/.rustybuns/releases/rustybuns/scripts/releases.ts --rerelease</code> to walk them one at a time, plan first.</p><ol class="owed">${owe.map(li).join("")}</ol>`;
}

export function page(d: Releases) {
  const count = (rows: Row[], dot: Dot) => rows.filter((r) => r.dot === dot).length;
  const legend = (rows: Row[]) => (["live", "error", "testing", "code"] as const).map((k) => `<span class="key d-${k}"><span class="dot"></span>${count(rows, k)} ${say[k].toLowerCase()}</span>`).join("");
  // Pacific, like the push column: the headless publisher's clock may not be.
  const when = pacific(d.at);
  return `<title>QNTBR Releases</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one column, two ledgers (repos, then RustyBuns' apps), a status dot leading each row like a rack's LED. */
:root { --bg: #f6f7f9; --panel: #ffffff; --fg: #15181d; --muted: #66707e; --line: #e2e5ea; --link: #c2410c;
  --live: #16a34a; --error: #dc2626; --testing: #eab308; --code: #a3aab5;
  --display: "Archivo", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f1216; --panel: #161a20; --fg: #e8ebef; --muted: #8b95a3; --line: #262c35; --link: #fb923c; --code: #555e6b; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #0f1216; --panel: #161a20; --fg: #e8ebef; --muted: #8b95a3; --line: #262c35; --link: #fb923c; --code: #555e6b; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.45 var(--display); }
main { max-width: 980px; margin: 0 auto; padding-block: 28px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 28px; }
header h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; margin: 0; text-wrap: balance; }
header p { margin: 4px 0 0; color: var(--muted); font: 13px var(--mono); }
section { display: grid; gap: 10px; min-width: 0; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; }
h2 b { color: var(--fg); font-size: 18px; letter-spacing: -0.01em; text-transform: none; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font: 12px var(--mono); color: var(--muted); }
.key { display: inline-flex; align-items: center; gap: 6px; }
.scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { text-align: left; font: 500 11px var(--mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 9px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
.n { text-align: right; width: 1%; white-space: nowrap; font: 500 16px var(--mono); }
.zero { color: var(--code); }
.who { display: grid; grid-template-columns: 12px auto; column-gap: 12px; align-items: center; min-width: 190px; }
.who a { color: var(--fg); font-weight: 700; text-decoration: none; }
.who a:hover, .who a:focus-visible { text-decoration: underline; }
.who small { grid-column: 2; color: var(--muted); font: 12px var(--mono); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--code); display: inline-block; }
.d-live .dot { background: var(--live); box-shadow: 0 0 0 3px color-mix(in srgb, var(--live) 22%, transparent); }
.d-error .dot { background: var(--error); box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 22%, transparent); }
.d-testing .dot { background: var(--testing); }
.d-code .who a { color: var(--muted); font-weight: 500; }
.when { white-space: nowrap; font: 13px var(--mono); color: var(--muted); }
.prod a { color: var(--link); font: 13px var(--mono); word-break: break-all; }
.none { color: var(--code); font: 13px var(--mono); }
td.owed { color: var(--testing); }
td.owed .none { color: var(--testing); }
ol.owed { margin: 0; padding: 0; list-style: none; display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; counter-reset: n; }
ol.owed li { background: var(--panel); padding: 10px 14px; display: grid; grid-template-columns: 28px 1fr; column-gap: 8px; row-gap: 2px; counter-increment: n; }
ol.owed li::before { content: counter(n); grid-row: span 3; font: 500 16px var(--mono); color: var(--muted); }
ol.owed b { font-weight: 700; }
ol.owed .when { color: var(--muted); }
code { font: 12px var(--mono); color: var(--fg); background: color-mix(in srgb, var(--line) 60%, transparent); padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; justify-self: start; }
.how, .clear { margin: 0; color: var(--muted); font: 13px var(--mono); }
a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; border-radius: 2px; }
</style>
<main>
  <header><h1>Releases</h1><p>Every app in RustyBuns, then every repo. Busiest first. Scanned ${esc(when)}; "today" starts at midnight.</p></header>
  <section><h2><b>To re-release</b> ${d.apps.filter((r) => r.owed).length} live apps behind main</h2>${owedList(d.apps)}</section>
  <section><h2><b>Apps in RustyBuns</b> ${d.apps.length}</h2><div class="legend">${legend(d.apps)}</div>${table(d.apps, "apps", true)}</section>
  <section><h2><b>Repos</b> ${d.repos.length} on QuinnsCode</h2><div class="legend">${legend(d.repos)}</div>${table(d.repos, "repos")}</section>
</main>`;
}

// ---- the schedule ------------------------------------------------------------------------------

const publishPrompt = () => `Refresh one of my Artifacts from a file on disk. Do only this, then reply in one line.
Releases page ${ARTIFACT}: Artifact read it, then Artifact publish with url ${ARTIFACT} and file_path ${file}.
Change nothing else. Reply: "releases published" or what failed.`;

const publish = () => headless(publishPrompt(), "Artifact ToolSearch", repo, dir);

const job = (from: string) => ({ label: LABEL, script: path.join(from, "scripts", "releases.ts"), args: ["--publish"], cwd: from,
  log: path.join(dir, "releases.log"), when: Array.from({ length: 16 }, (_, i) => ({ Hour: 7 + i, Minute: 17 })) });

// ---- re-release --------------------------------------------------------------------------------

/** Held while --rerelease runs, so the hourly --publish doesn't move this checkout under a deploy. */
const lock = path.join(dir, "rerelease.lock");
const held = () => { try { process.kill(Number(readFileSync(lock, "utf8")), 0); return true; } catch { return false; } };
const run = (cmd: string[], cwd: string) => Bun.spawnSync(cmd, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exitCode === 0;
const ask = (q: string) => (globalThis.prompt(q) ?? "").trim().toLowerCase();

/** Walk the owed apps busiest first: ask, plan (for a rustybuns deploy), ask again, deploy. The CLI's own guards still
 *  hold (behind main, deletes, its y/N). A deploy that doesn't write itself down gets a report-deploy, so the page
 *  shows it next hour. */
function rerelease(d: Releases) {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo }).stdout.toString().trim();
  const main = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: repo }).stdout.toString().trim();
  if (!head || head !== main) { console.log(`${repo} is not on origin/main; run it from ~/.rustybuns/releases/rustybuns, which follows main.`); return 1; }
  const cli = path.join(repo, "packages", "cli", "src", "index.ts");
  const owe = d.apps.filter((r) => r.owed && r.deploy && r.dir && r.id);
  const done: string[] = [], skipped: string[] = [], failed: string[] = [];
  console.log(`${owe.length} live apps behind main. y deploys, s skips, q stops.`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(lock, String(process.pid));
  try {
    for (const [i, r] of owe.entries()) {
      const { id, dir: folder, deploy } = r as Row & { id: string; dir: string; deploy: { plan: boolean; cmd: string } };
      console.log(`\n[${i + 1}/${owe.length}] ${r.name}: merged ${pacific(r.pushed ?? "")}, deployed ${r.deployed ? pacific(r.deployed) : "not logged"}`);
      const a = ask(`  ${deploy.plan ? "plan it" : `run ${deploy.cmd}`}? [y/s/q]`);
      if (a === "q") break;
      if (a !== "y") { skipped.push(r.name); continue; }
      const cwd = path.join(repo, folder), t0 = Date.now();
      if (deploy.plan) {
        // No state here means a plan that makes a second copy of everything (FRESH), not an update (eqosys, 2026-11-21).
        const dirs = stateDirs(cwd, sharedStateBase(cwd));
        if (!hasState(dirs)) {
          console.log(`  no deploy state for ${r.name} from this checkout (looked in ${dirs.join(", ")}). A plan here would make it all new beside what's live. Deploy it from the checkout it was last deployed from.`);
          failed.push(`${r.name} (no state here)`); continue;
        }
        if (!run(["bun", cli, "plan"], cwd)) { failed.push(`${r.name} (plan)`); continue; }
        if (ask("  read the plan: any delete or replace, say n. Deploy now? [y/N]") !== "y") { skipped.push(r.name); continue; }
      }
      if (!run(["sh", "-c", deploy.cmd], cwd)) { failed.push(r.name); continue; }
      const log = (() => { try { return readFileSync(DEPLOY_LOG, "utf8"); } catch { return null; } })();
      if (!(Date.parse(lastDeploys(log, [id]).get(id)?.at ?? "") >= t0)) run(["bun", cli, "report-deploy", "--app", id], cwd);
      done.push(r.name);
    }
  } finally { rmSync(lock, { force: true }); }
  console.log(`\ndeployed ${done.length}: ${done.join(", ") || "none"}\nskipped ${skipped.length}: ${skipped.join(", ") || "none"}\nfailed ${failed.length}: ${failed.join(", ") || "none"}`);
  return failed.length ? 1 : 0;
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  if (args.includes("--install")) {
    const j = job(jobCheckout(repo, path.join(dir, "rustybuns")));
    console.log(install(j) ? `installed: ${LABEL} publishes the releases page at :17, 7am to 10pm from ${j.cwd}, log ${j.log}` : "launchctl bootstrap failed");
    process.exit();
  }
  if (args.includes("--uninstall")) { uninstall(LABEL); console.log("uninstalled"); process.exit(); }
  const publishing = args.includes("--publish"), walking = args.includes("--rerelease");
  if (publishing && held()) { console.log("a --rerelease is deploying from this checkout; skipping this hour"); process.exit(); }
  if (walking && held()) { console.log(`another --rerelease is running (${lock})`); process.exit(1); }
  // The job's checkout stays wherever it was installed; catch it up so page changes and new apps reach the job (#5428).
  if ((publishing || walking) && !process.env.RELEASES_CAUGHT_UP && catchUp(repo) === "moved") {
    const again = Bun.spawnSync([process.execPath, import.meta.path, ...args], { cwd: repo, stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, RELEASES_CAUGHT_UP: "1" } });
    process.exit(again.exitCode ?? 1);
  }
  const d = await releases();
  if (walking) process.exit(rerelease(d));
  const out = publishing ? file : args.includes("--html") ? args[args.indexOf("--html") + 1] : undefined;
  if (args.includes("--json")) console.log(JSON.stringify(d, null, 2));
  else if (out) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, page(d));
    console.log(`${d.at} wrote ${out}`);
    if (publishing) publish();
  }
  else for (const [title, rows] of [["Apps in RustyBuns", d.apps], ["Repos", d.repos]] as const) {
    console.log(`\n${title}`);
    for (const r of rows) console.log(`${{ live: "●", error: "✕", testing: "◐", code: "·" }[r.dot]} ${r.name.padEnd(28)} ${String(r.today).padStart(3)} ${String(r.week).padStart(4)}  ${(r.pushed ? pacific(r.pushed) : "never").padEnd(24)} ${r.link ?? "-"}`);
  }
}
