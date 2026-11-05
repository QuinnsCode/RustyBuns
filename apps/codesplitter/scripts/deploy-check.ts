// The deploy journey, for real, through the same API calls the Ship and Deploy panels make: an app is
// made into a repo, committed, given a stage, and shipped with this machine's Cloudflare login. Nothing is
// faked: clone, bun install, rustybuns deploy and the check all run, and the Worker stays up afterwards.
//
//   bun scripts/deploy-check.ts                          a throwaway one-Worker app, deployed twice (the second updates the same Worker)
//   bun scripts/deploy-check.ts --app ../hono-example    a Rusty Buns app folder instead (its `workspace:` ranges become npm's versions)
//     --cli local        this checkout's @rustybuns packages (packed) and the pinned deploy set, in place of npm's: what a user
//                        gets after the next release and `rustybuns add deploy`
//     --try              Ship's Build and plan first (clone, install, init, infra, plan --offline), then the deploys below
//     --init             a Rusty-Buns-compatible app (no rustybuns.config.ts): Ship's Init on a branch first, that branch
//                        merged and committed, its diff approved as the owner would, then the deploys below run on it
//     --preview          a preview first: deploy to preview-<id>, check it answers, destroy it
//     --drop COUNTER     the "something changed" path: deploy, commit a config without that binding, plan against the stage
//                        (its rows must show the binding going), deploy that plan (the guard must refuse: it would delete
//                        data), then tear the stage down through Deploy settings' route
//   bun scripts/deploy-check.ts --destroy [--app ...]    take the stage down: the kept Alchemy state, put back in a fresh copy
//
// Each step prints its time and the end of its log, the part an agent is handed to fix it. Without --url it runs the
// app in-process (src/local.ts); the deploy itself runs as this process, so rustybuns deploy reads this machine's
// wrangler login itself (leave CLOUDFLARE_API_TOKEN unset, #2669). With --url it drives a running `bun run desktop`
// (note the URL and token it prints): --url http://127.0.0.1:PORT --cookie 'rb_token_PORT=TOKEN'.
//
// --hosted runs it against the live site (#309): the deploy happens in the site's DeployRunner container with a
// deploy key stored for the repo, not on this machine. Sign in there as an admin and pass your session cookie; the
// key is the Cloudflare env, a token scoped to Workers Scripts: Edit only.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bun scripts/deploy-check.ts --hosted \
//     --url https://codesplitter.notryanquinn.workers.dev --cookie '__Secure-better-auth.session_token=...'
//
// It stores the key, deploys twice and checks the second updated the same Worker, that the token never shows in the
// log, and that the deploy step's log grew while it ran. --hosted --destroy deletes that Worker with the same token
// and the repo's stored key; then delete the token in the dashboard.

import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEPLOY_DEPS, DEPLOY_OVERRIDES } from "../../../packages/cli/src/glue/deploy-deps.ts";
import { local, remote, type Call } from "../src/local.ts";
import { diffToOps } from "../src/sync.ts";
import type { Run } from "../src/preview.ts";

const { values: a } = parseArgs({ options: {
  url: { type: "string" }, cookie: { type: "string", default: "" },
  as: { type: "string", default: "quinn" }, repo: { type: "string" },
  stage: { type: "string" }, destroy: { type: "boolean", default: false }, hosted: { type: "boolean", default: false },
  app: { type: "string" }, cli: { type: "string", default: "npm" }, try: { type: "boolean", default: false }, init: { type: "boolean", default: false },
  preview: { type: "boolean", default: false }, drop: { type: "string" },
} });
const folder = a.app ? resolve(a.app) : null;
const [user, repo] = [a.as!, a.repo ?? (folder ? folder.split("/").pop()!.toLowerCase().replace(/[^a-z0-9-]/g, "-") : "deploy-check")];
const stage = a.stage ?? (a.hosted ? "site-check" : a.drop ? `check-${crypto.randomUUID().slice(0, 6)}` : "desk-check");
const token = process.env.CLOUDFLARE_API_TOKEN ?? "", accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
if (a.hosted && !(a.url && a.cookie && token && accountId)) throw new Error("--hosted needs --url, --cookie (your signed-in session), CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");

const t0 = performance.now();
const say = (s: string) => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`);

/** --cli local: this checkout's @rustybuns packages as tarballs, `file:` specs a clone on this machine installs. */
const packs: Record<string, string> = {};
if (a.cli === "local") {
  const dir = mkdtempSync(join(tmpdir(), "rb-packs-"));
  process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const p of ["cli", "shell-bun", "ports"]) {
    const pkgDir = resolve(import.meta.dir, "../../../packages", p), v = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
    Bun.spawnSync(["bun", "pm", "pack", "--destination", dir], { cwd: pkgDir });
    packs[`@rustybuns/${p}`] = `file:${dir}/rustybuns-${p}-${v}.tgz`;
  }
}

/** A package.json as a clone of the app alone installs it: `workspace:` ranges become npm's versions (or this checkout's packs). */
function standalone(pkg: any) {
  if (a.cli === "local") { pkg.devDependencies = { ...pkg.devDependencies, ...DEPLOY_DEPS }; pkg.overrides = { ...pkg.overrides, ...DEPLOY_OVERRIDES, ...packs }; }
  for (const field of ["dependencies", "devDependencies"]) for (const [dep, range] of Object.entries<string>(pkg[field] ?? {})) {
    if (!range.startsWith("workspace:")) continue;
    const v = packs[dep] ?? Bun.spawnSync(["npm", "view", dep, "version"]).stdout.toString().trim();
    if (!v) throw new Error(`${dep} is ${range} and npm has no version of it: this app can't leave the monorepo yet`);
    pkg[field][dep] = v;
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

/** The throwaway app: one Worker, no bindings, the pinned Alchemy set (`rustybuns add deploy`). */
const throwaway = (): Record<string, string> => ({
  "package.json": standalone({ name: repo, private: true, type: "module", devDependencies: { "@rustybuns/cli": "workspace:*", ...DEPLOY_DEPS }, overrides: { ...DEPLOY_OVERRIDES } }),
  "rustybuns.config.ts": `import { defineConfig } from "@rustybuns/cli/config";

// A throwaway Worker for codeSplitter's desktop Deploy check. Destroy it after.
export default defineConfig({
  name: ${JSON.stringify(repo)},
  worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01" },
  bindings: {},
  targets: { edge: { provider: "cloudflare" } },
});
`,
  "src/worker.ts": `export default {\n  fetch: () => new Response("shipped from the codeSplitter desktop\\n"),\n};\n`,
});

/** The app folder's files as git has them (no node_modules, no dist). */
function fromFolder(dir: string): Record<string, string> {
  const listed = Bun.spawnSync(["git", "ls-files"], { cwd: dir }).stdout.toString().split("\n").filter(Boolean);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => n === "node_modules" || n === "dist" || n.startsWith(".") ? []
    : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [relative(dir, join(d, n))]);
  const out: Record<string, string> = {};
  for (const p of listed.length ? listed : walk(dir)) {
    const text = readFileSync(join(dir, p), "utf8");
    out[p] = p === "package.json" ? standalone(JSON.parse(text)) : text;
  }
  return out;
}

const APP = folder ? fromFolder(folder) : throwaway();
const app = a.url || (a.destroy && !a.hosted) ? null : await local({ GH_CLI: "off" });
const call: Call = app ?? remote(a.url!, a.cookie);
const send = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
  const res = await call(user, path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
};
const base = `/api/repos/${user}/${repo}`;

/** Where deploy.ts keeps a desktop deploy's Alchemy state (the app is at the repo's root). */
const keptState = join(process.env.DEPLOY_STATE_DIR ?? join(homedir(), ".codesplitters/alchemy"), user, repo);

/** Take the stage down: the app in a fresh copy, the kept state put back, rustybuns destroy. Async spawns: an in-process app answers git while they run. */
async function destroy() {
  if (!existsSync(keptState)) throw new Error(`no kept Alchemy state at ${keptState}`);
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-destroy-"));
  for (const [path, text] of Object.entries(APP)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
  cpSync(keptState, join(dir, ".alchemy/state"), { recursive: true });
  // A compatible app's folder has no config: init it again, as Try's init step did, to name the same stack.
  const init = APP["rustybuns.config.ts"] ? [] : [["bun", "add", "-d", "@rustybuns/cli", "@rustybuns/shell-bun"], ["bun", "x", "rustybuns", "init"], ["bun", "x", "rustybuns", "add", "deploy"]];
  for (const cmd of [["bun", "install"], ...init, ["bun", "x", "rustybuns", "destroy", "--yes", "--stage", stage]]) {
    const r = Bun.spawn(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "1" } });
    const [o, e, code] = await Promise.all([new Response(r.stdout).text(), new Response(r.stderr).text(), r.exited]);
    if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}; the copy is kept in ${dir}\n${(o + e).split("\n").slice(-20).join("\n")}`);
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(keptState, { recursive: true, force: true });
  say(`destroyed ${stage}`);
}

if (a.hosted && a.destroy) {
  // The Worker's script name is its workers.dev URL's first label.
  const url = (await send(`${base}/deploy`)).run?.url;
  if (url) {
    const name = new URL(url).hostname.split(".")[0];
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${name}?force=true`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    console.log(`delete Worker ${name}: ${res.status}${res.ok ? "" : ` ${await res.text()}`}`);
  } else console.log("no deployed URL on the last run; no Worker to delete");
  const res = await call(user, `${base}/deploy/key`, { method: "DELETE" });
  console.log(`delete the stored deploy key: ${res.status} ${await res.text()}`);
  process.exit(0);
}
if (a.destroy) { await destroy(); process.exit(0); }

if (a.hosted) {
  // Accounts, not aliases: the cookie is who we are, and only an admin deploys.
  const s = (await (await call(null, "/api/session")).json()) as { user: string | null; admin?: boolean };
  if (s.user !== user || !s.admin) throw new Error(`the cookie signs in as ${s.user ?? "nobody"}${s.admin ? "" : " (not an admin)"}; expected admin ${user}`);
} else await send("/api/login", { name: user });
if ((await call(user, base)).status === 404) await send("/api/repos", { name: repo, visibility: "private" });
for (const [path, content] of Object.entries(APP)) {
  await send(`${base}/files`, { path, content });
  await send(`${base}/do/commit?path=${encodeURIComponent(path)}`, { message: `add ${path}` });
}
await send(`${base}/deploy`, { stage }, "PUT");
say(`${user}/${repo} committed (${Object.keys(APP).length} files), stage ${stage}`);
if (a.hosted) {
  const key = (await send(`${base}/deploy/key`, { token, account_id: accountId }, "PUT")) as { set?: boolean; last4?: string };
  console.log(`stored the deploy key (…${key.last4})`);
}

/** Start a run on `route` and poll it as the page does, printing each step as it settles, with the end of its log. */
async function walk(label: string, route: string, body: unknown = {}, poll = route) {
  const started = await send(route, body);
  if (started.error) { say(`${label}: refused: ${started.error}`); return { green: false, run: null as Run | null, grew: false }; }
  const shown = new Set<string>(), seen = new Map<string, number>();
  let run: Run | null = null, grew = false;
  for (;;) {
    run = (await send(poll)).run;
    for (const s of run?.steps ?? []) {
      // A running step whose log gets longer between polls is streaming, not landing at the end.
      if (s.status === "running" && s.out.length > (seen.get(s.key) ?? Infinity)) grew = true;
      if (s.status === "running") seen.set(s.key, Math.max(seen.get(s.key) ?? 0, s.out.length));
      if (s.status === "running" || s.status === "waiting" || shown.has(s.key)) continue;
      shown.add(s.key);
      say(`${label} ${s.key.padEnd(8)} ${s.status}${s.ms ? ` in ${(s.ms / 1000).toFixed(1)}s` : ""}`);
      if (s.status === "failed") console.log(s.out.trim().split("\n").slice(-12).map((l) => `         | ${l}`).join("\n"));
    }
    if (!run || run.done) break;
    await Bun.sleep(1000);
  }
  const green = !!run?.steps.every((s) => s.status === "done" || s.status === "skipped") && !run.steps.some((s) => s.status === "failed");
  say(`${label} ${green ? "green" : "NOT green"}${run?.url ? ` · ${run.url}` : ""}${run?.note ? `\n         note: ${run.note}` : ""}`);
  return { green, run, grew };
}

/** Press Deploy, and on the site check the key never reached the log. */
async function deploy(label = "deploy ", body: unknown = {}) {
  const r = await walk(label, `${base}/deploy`, body);
  const log = r.run?.steps.map((s) => s.out).join("\n") ?? "";
  if (a.hosted) console.log(`log: ${token && log.includes(token) ? "SHOWS THE TOKEN" : "no token"}, ${log.includes("<deploy key>") ? "shows <deploy key>" : "no <deploy key>"}, ${r.grew ? "streamed" : "did not grow while running"}`);
  return { green: r.green, url: r.run?.url, leaked: !!token && log.includes(token) };
}

/** The teardown line to print: the same app and the same packages (a --cli local stack won't install npm's). */
const downCmd = `bun scripts/deploy-check.ts --destroy${a.cli === "local" ? " --cli local" : ""}${a.app ? ` --app ${a.app}` : ""} --stage ${stage}`;

let ok = true;
if (a.init) {
  // Init on a branch: init's config and deploy dependencies land on a branch as agent-rustybuns, for the owner to merge.
  const init = await walk("init   ", `${base}/try`, { save: true });
  const saved = init.run?.steps.find((s) => s.key === "save")?.out ?? "";
  const branch = saved.match(/^branch (\S+)$/m)?.[1];
  if (!init.green || !branch) ok = false;
  else {
    const merged = await send(`${base}/branches/${encodeURIComponent(branch)}/merge`, {});
    if (merged.status !== "merged") { say(`merge ${branch}: ${JSON.stringify(merged).slice(0, 400)}`); ok = false; }
    else {
      // The merge commits what it merged (#3402), so the deploy's clone has init's files.
      const paths: string[] = merged.merged.map((m: { path: string }) => m.path);
      // destroy() rebuilds the app from APP: it needs the files init wrote, as main has them now.
      for (const path of paths) APP[path] = (await send(`${base}/do/file?path=${encodeURIComponent(path)}`)).lines.map((l: { text: string }) => l.text).join("\n");
      say(`merged ${branch}: ${paths.join(", ")}`);
    }
  }
}
if (ok && a.try) ok = (await walk("try    ", `${base}/try`)).green && ok;
if (ok && a.preview) ok = (await walk("preview", `${base}/preview`)).green && ok;
if (ok && a.drop) {
  const first = await deploy();
  const cfg = APP["rustybuns.config.ts"] ?? "", changed = cfg.replace(new RegExp(`"?${a.drop}"?\\s*:\\s*\\{[^}]*\\},?`), "");
  if (!first.green) ok = false;
  else if (changed === cfg) { say(`--drop ${a.drop}: no such binding in rustybuns.config.ts`); ok = false; }
  else {
    // POST /files only makes a file; an edit is line ops against the lines it has now.
    const doc = await send(`${base}/do/file?path=rustybuns.config.ts`);
    await send(`${base}/do/ops?path=rustybuns.config.ts`, { ops: diffToOps(doc.lines, changed.split("\n")) });
    await send(`${base}/do/commit?path=rustybuns.config.ts`, { message: `drop ${a.drop}` });
    say(`committed rustybuns.config.ts without ${a.drop}; planning against ${stage}, as Ship's Deploy tab does`);
    const plan = await walk("plan   ", `${base}/deploy/plan`);
    const rows = plan.run?.plan ?? [];
    for (const r of rows) say(`  plan ${r.action.padEnd(8)} ${r.id}`);
    const shows = rows.some((r) => r.id.endsWith(`/${a.drop}`) || r.action === "delete");
    say(shows ? `the plan shows ${a.drop} going, before Deploy` : `the plan does NOT show ${a.drop} going`);
    const again = await deploy("deploy2", plan.run ? { plan: plan.run.id } : {});
    say(again.green ? `the guard let a deploy that drops ${a.drop} through` : "refused, as it should be");
    ok = plan.green && shows && !again.green;
  }
  if (!app) say(`take it down with: ${downCmd}`);
  else ok = (await walk("down   ", `${base}/deploy/destroy`, { stage }, `${base}/deploy`)).green && ok;
} else if (ok) {
  // Init's commits are agent-rustybuns's, so the first deploy waits for the owner to read that diff: approve it as they would.
  const tip = a.init ? (await send(`${base}/deploy/review`)).tip as string | undefined : undefined;
  if (tip) say(`approving init's commits up to ${tip.slice(0, 7)}, as the owner does after reading the diff`);
  const first = await deploy("deploy ", tip ? { approve: tip, approve_unseen: true } : {}), second = await deploy("deploy2");
  say(`second deploy ${first.url && first.url === second.url ? "updated the same Worker" : `went to ${second.url ?? "no URL"}, not ${first.url ?? "no URL"}`}`);
  ok = first.green && second.green && first.url === second.url && !first.leaked && !second.leaked;
  say(`left up; take it down with: ${downCmd}`);
}
app?.close();
process.exit(ok ? 0 : 1);
