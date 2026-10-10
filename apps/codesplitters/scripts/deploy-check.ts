// One real Deploy from the desktop, end to end, through the same API calls the
// Deploy panel makes: a throwaway Rusty Buns Worker (rustybuns.config.ts at its
// root) is made into a repo here, committed, given a stage, and shipped with this
// machine's Cloudflare login. Nothing is faked: clone, bun install, rustybuns
// deploy and the check all run for real, and the Worker stays up afterwards.
//
//   bun run desktop        # note the URL and token it prints
//   CLOUDFLARE_API_TOKEN=$(npx wrangler auth token | tail -1) CLOUDFLARE_ACCOUNT_ID=... \
//     bun scripts/deploy-check.ts --url http://127.0.0.1:PORT --cookie 'rb_token_PORT=TOKEN'
//
// Without --url it runs the app in-process (src/local.ts) instead; the deploy
// itself runs as this process, so either way it needs the Cloudflare env above
// unless Alchemy's own profile works. Take the Worker down afterwards with
// --destroy (same --stage): it puts the kept Alchemy state back in a fresh copy
// of the app and runs rustybuns destroy there.
//
// --hosted runs it against the live site (#309): the deploy happens in the site's
// DeployRunner container with a deploy key stored for the repo, not on this
// machine. Sign in there as an admin and pass your session cookie; the key is
// the Cloudflare env above, a token scoped to Workers Scripts: Edit only.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bun scripts/deploy-check.ts --hosted \
//     --url https://codesplitters.notryanquinn.workers.dev --cookie '__Secure-better-auth.session_token=...'
//
// It stores the key, deploys twice and checks the second updated the same Worker,
// that the token never shows in the log, and that the deploy step's log grew while
// it ran. --hosted --destroy deletes that Worker with the same token and the
// repo's stored key; then delete the token in the dashboard.

import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { local, remote, type Call } from "../src/local.ts";
import type { Run } from "../src/preview.ts";

const { values: a } = parseArgs({ options: {
  url: { type: "string" }, cookie: { type: "string", default: "" },
  as: { type: "string", default: "quinn" }, repo: { type: "string", default: "deploy-check" },
  stage: { type: "string" }, destroy: { type: "boolean", default: false }, hosted: { type: "boolean", default: false },
} });
const [user, repo, stage] = [a.as!, a.repo!, a.stage ?? (a.hosted ? "site-check" : "desk-check")];
const token = process.env.CLOUDFLARE_API_TOKEN ?? "", accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
if (a.hosted && !(a.url && a.cookie && token && accountId)) throw new Error("--hosted needs --url, --cookie (your signed-in session), CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");

/** The throwaway app: one Worker, no bindings, the pinned Alchemy set (`rustybuns add deploy`). */
const pins = { effect: "4.0.0-rc.112", "@effect/platform-bun": "4.0.0-rc.112", "@effect/platform-node": "4.0.0-rc.112" };
const APP: Record<string, string> = {
  "package.json": JSON.stringify({
    name: repo, private: true, type: "module",
    devDependencies: { "@rustybuns/cli": "0.1.9", alchemy: "2.0.0-beta.77", "@alchemy.run/frontend-frameworks": "2.0.0-beta.77", ...pins },
    overrides: { ...pins, "@effect/platform-node-shared": "4.0.0-rc.112", "@effect/vitest": "4.0.0-rc.112" },
  }, null, 2) + "\n",
  "rustybuns.config.ts": `import { defineConfig } from "@rustybuns/cli/config";

// A throwaway Worker for codeSplitters' desktop Deploy check. Destroy it after.
export default defineConfig({
  name: ${JSON.stringify(repo)},
  worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01" },
  bindings: {},
  targets: { edge: { provider: "cloudflare" } },
});
`,
  "src/worker.ts": `export default {\n  fetch: () => new Response("shipped from the codeSplitters desktop\\n"),\n};\n`,
};

const app = a.url || a.destroy ? null : await local({ GH_CLI: "off" });
const call: Call = app ?? remote(a.url!, a.cookie);
const send = async (path: string, body: unknown, method = "POST") => {
  const res = await call(user, path, { method, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const lastRun = async () => ((await (await call(user, `/api/repos/${user}/${repo}/deploy`)).json()) as { run: Run | null }).run;

if (a.hosted && a.destroy) {
  // The Worker's script name is its workers.dev URL's first label.
  const url = (await lastRun())?.url;
  if (url) {
    const name = new URL(url).hostname.split(".")[0];
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${name}?force=true`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    console.log(`delete Worker ${name}: ${res.status}${res.ok ? "" : ` ${await res.text()}`}`);
  } else console.log("no deployed URL on the last run; no Worker to delete");
  const res = await call(user, `/api/repos/${user}/${repo}/deploy/key`, { method: "DELETE" });
  console.log(`delete the stored deploy key: ${res.status} ${await res.text()}`);
  process.exit(0);
}

if (a.destroy) {
  // Where deploy.ts keeps a desktop deploy's Alchemy state (the app is at the repo's root).
  const state = join(process.env.DEPLOY_STATE_DIR ?? join(homedir(), ".codesplitters/alchemy"), user, repo);
  if (!existsSync(state)) throw new Error(`no kept Alchemy state at ${state}`);
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-destroy-"));
  for (const [path, text] of Object.entries(APP)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
  cpSync(state, join(dir, ".alchemy/state"), { recursive: true });
  for (const cmd of [["bun", "install"], ["bun", "x", "rustybuns", "destroy", "--yes", "--stage", stage]]) {
    console.log(`$ ${cmd.join(" ")}`);
    const code = await Bun.spawn(cmd, { cwd: dir, stdout: "inherit", stderr: "inherit", env: { ...process.env, CI: "1" } }).exited;
    if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}; the copy is kept in ${dir}`);
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
  process.exit(0);
}

if (a.hosted) {
  // Accounts, not aliases: the cookie is who we are, and only an admin deploys.
  const s = (await (await call(null, "/api/session")).json()) as { user: string | null; admin?: boolean };
  if (s.user !== user || !s.admin) throw new Error(`the cookie signs in as ${s.user ?? "nobody"}${s.admin ? "" : " (not an admin)"}; expected admin ${user}`);
} else await send("/api/login", { name: user });
if ((await call(user, `/api/repos/${user}/${repo}`)).status === 404) await send("/api/repos", { name: repo, visibility: "private" });
for (const [path, content] of Object.entries(APP)) {
  await send(`/api/repos/${user}/${repo}/files`, { path, content });
  await send(`/api/repos/${user}/${repo}/do/commit?path=${encodeURIComponent(path)}`, { message: `add ${path}` });
}
await send(`/api/repos/${user}/${repo}/deploy`, { stage }, "PUT");
if (a.hosted) {
  const key = (await send(`/api/repos/${user}/${repo}/deploy/key`, { token, account_id: accountId }, "PUT")) as { set?: boolean; last4?: string };
  console.log(`stored the deploy key (…${key.last4})`);
}

/** Press Deploy and poll the panel as the page does, printing each step as it settles. */
async function deploy() {
  const t = Date.now();
  console.log(`\nDeploy ${user}/${repo} to ${stage}:`, (await send(`/api/repos/${user}/${repo}/deploy`, {})).run?.id ?? "already running");
  const shown = new Set<string>(), seen = new Map<string, number>();
  let run: Run | null = null, grew = false;
  for (;;) {
    run = await lastRun();
    for (const s of run?.steps ?? []) {
      // A running step whose log gets longer between polls is streaming, not landing at the end.
      if (s.status === "running" && s.out.length > (seen.get(s.key) ?? Infinity)) grew = true;
      if (s.status === "running") seen.set(s.key, Math.max(seen.get(s.key) ?? 0, s.out.length));
      if ((s.status === "running" || s.status === "waiting") || shown.has(s.key)) continue;
      shown.add(s.key);
      console.log(`\n── ${s.key}: ${s.status}${s.ms ? ` (${(s.ms / 1000).toFixed(1)}s)` : ""}\n${s.out.trim().split("\n").slice(-12).join("\n")}`);
    }
    if (!run || run.done) break;
    await Bun.sleep(2000);
  }
  const log = run?.steps.map((s) => s.out).join("\n") ?? "";
  const green = !!run?.steps.every((s) => s.status === "done");
  console.log(`\n${green ? "green" : "NOT green"} in ${((Date.now() - t) / 1000).toFixed(0)}s, commit ${run?.commit}, ${run?.url ?? "no URL"}${run?.note ? `\nnote: ${run.note}` : ""}`);
  if (a.hosted) console.log(`log: ${token && log.includes(token) ? "SHOWS THE TOKEN" : "no token"}, ${log.includes("<deploy key>") ? "shows <deploy key>" : "no <deploy key>"}, ${grew ? "streamed" : "did not grow while running"}`);
  return { green, url: run?.url, leaked: !!token && log.includes(token) };
}

const first = await deploy(), second = await deploy();
console.log(`\nsecond deploy ${first.url && first.url === second.url ? "updated the same Worker" : `went to ${second.url ?? "no URL"}, not ${first.url ?? "no URL"}`}`);
app?.close();
if (!first.green || !second.green || first.url !== second.url || first.leaked || second.leaked) process.exit(1);
