// Mirrors Artifacts repos into the new namespace (#823, src/artifact-move.ts): `git clone --mirror` from the old
// remote and `git push --mirror` to the new one, for each repo in a plan POST /api/admin/artifacts/copy gave.
//
//   bun scripts/move-artifacts.ts plan.json
//
// plan.json is a list of { name, from: { remote, token }, to: { remote, token } } (the copy route's `repos`, pages
// joined). The tokens last an hour and go to git as a header, not in argv. Nothing is deleted. A repo that
// fails is listed at the end; run it again with a fresh plan.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Side = { remote: string; token: string };
export type Plan = { name: string; from: Side; to: Side }[];

/** Git's environment for one remote: the token as Basic auth on every request, the way Artifacts takes it. */
export const authEnv = (token: string): Record<string, string> => ({
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa(`x:${token.split("?")[0]}`)}`,
  GIT_TERMINAL_PROMPT: "0",
});

function git(args: string[], cwd: string, side: Side) {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...authEnv(side.token) }, stdout: "ignore", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString().trim().split("\n").at(-1) ?? `git ${args[0]} failed`);
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: bun scripts/move-artifacts.ts plan.json");
  const plan = JSON.parse(readFileSync(file, "utf8")) as Plan;
  const failed: string[] = [];
  for (const r of plan) {
    const dir = mkdtempSync(join(tmpdir(), "move-artifact-"));
    try {
      git(["clone", "--mirror", "--quiet", r.from.remote, "repo.git"], dir, r.from);
      git(["push", "--mirror", "--quiet", r.to.remote], join(dir, "repo.git"), r.to);
      console.log(`copied ${r.name}`);
    } catch (e) {
      failed.push(r.name);
      console.error(`FAILED ${r.name}: ${(e as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(failed.length ? `${failed.length} of ${plan.length} failed: ${failed.join(", ")}` : `all ${plan.length} copied: now POST /api/admin/artifacts/verify`);
  process.exit(failed.length ? 1 : 0);
}
