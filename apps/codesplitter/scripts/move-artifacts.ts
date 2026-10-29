// Copies every repo's Artifact into the new namespace with a git mirror push (#823), then checks the copies.
// The Worker can't: Artifacts' `import` answers 401 on a private repo, and a Worker has no git.
//
//   cd apps/codesplitter
//   bun scripts/move-artifacts.ts --url https://… --cookie '<an admin session cookie>'            copy, then verify
//   bun scripts/move-artifacts.ts --url https://… --cookie '…' --verify                           only verify
//
// The site must be deployed with ARTIFACTS_NEXT bound to the new namespace first (artifact-move.ts has the steps).
// It changes nothing the site reads: no stored remote moves and the binding stays. That is the owner's cutover.
// Safe to run again: a repo whose copy already has the old one's head is skipped.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { arr, type Guard, nul, obj, type Of, str } from "@rustybuns/util/guard";

const JobG = obj({ name: str(), from: str(Infinity), to: str(Infinity) });
export type Job = { name: string; from: string; to: string };

const Copied = obj({ todo: arr(JobG, Infinity), skipped: arr(str(), Infinity), failed: arr(obj({ name: str(), error: str(Infinity, { min: 0 }) }), Infinity), next: nul(str()) });
const Verified = obj({ verified: arr(str(), Infinity), mismatched: arr(obj({ name: str(), why: str(Infinity, { min: 0 }) }), Infinity), next: nul(str()) });

/** A remote as it's shown: any user:password in it left out. */
const shown = (url: string) => url.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");

async function git(args: string[], cwd?: string) {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  // git echoes the remote on failure, and the remote has a token in it.
  if (code) throw new Error(err.trim().replace(/(\w+:\/\/)[^@/\s]+@/g, "$1"));
}

/** Mirrors one repo: every branch and tag of `from` pushed to `to`, through a bare clone in a temp dir. */
export async function mirror(job: Job) {
  const dir = mkdtempSync(join(tmpdir(), "move-artifacts-"));
  try {
    await git(["clone", "--mirror", "--quiet", job.from, dir]);
    await git(["push", "--mirror", "--quiet", job.to], dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: { url: { type: "string" }, cookie: { type: "string", default: "" }, verify: { type: "boolean", default: false } } });
  if (!a.url) throw new Error("--url is the site to move, --cookie an admin's session");
  const post = async <T>(path: string, after: string | null, guard: Guard<T>): Promise<T> => {
    const res = await fetch(a.url!.replace(/\/$/, "") + "/api/admin/artifacts/" + path, { method: "POST", headers: { cookie: a.cookie!, "content-type": "application/json" }, body: JSON.stringify({ after: after ?? "" }) });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return guard(await res.json());
  };
  const failed: string[] = [];

  if (!a.verify) {
    for (let after: string | null = null, more = true; more;) {
      const r: Of<typeof Copied> = await post("copy", after, Copied);
      for (const f of r.failed) failed.push(`${f.name}: ${f.error}`);
      for (const job of r.todo) {
        try { await mirror(job); console.log(`copied ${job.name} (${shown(job.from)})`); }
        catch (e) { failed.push(`${job.name}: ${(e as Error).message}`); }
      }
      for (const n of r.skipped) console.log(`skipped ${n}: already copied`);
      after = r.next; more = !!after;
    }
  }

  let verified = 0;
  for (let after: string | null = null, more = true; more;) {
    const r: Of<typeof Verified> = await post("verify", after, Verified);
    verified += r.verified.length;
    for (const m of r.mismatched) failed.push(`${m.name}: ${m.why}`);
    after = r.next; more = !!after;
  }
  console.log(`${verified} verified, ${failed.length} not`);
  for (const f of failed) console.log(`  ${f}`);
  process.exit(failed.length ? 1 : 0);
}
