// Run one coding agent on one file of a repo. The agent works on a plain-text
// copy in a scratch directory; when it stops, its edit is diffed against the
// snapshot and posted to the file's Durable Object as line ops, so the edit
// shows up live and carries the agent's name in blame like any other edit.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Call } from "./local.ts";
import type { Doc, Op } from "./lines.ts";
import { harnessCommand, taskPrompt, type Command, type Harness } from "./harness.ts";
import { diffToOps, rebase } from "./sync.ts";

export type Exec = (cmd: Command, cwd: string) => Promise<{ code: number; out: string }>;

/** Runs the CLI with its working directory set to `cwd`, capturing stdout and stderr. */
export const execCommand: Exec = async (cmd, cwd) => {
  const proc = Bun.spawn([cmd.bin, ...cmd.args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: out + err };
};

export interface Result {
  harness: Harness;
  path: string;
  changed: boolean;
  applied: number;
  skipped: Op[];
  rev: number;
  output: string;
}

/** What a file's text looks like on disk: lines joined by \n with one trailing \n. */
export const toDisk = (lines: { text: string }[]) => lines.length ? lines.map((l) => l.text).join("\n") + "\n" : "";
/** Back from disk to the lines the agent left. */
export const fromDisk = (s: string) => s === "" ? [] : s.replace(/\n$/, "").split("\n");

export async function runAgent(call: Call, opts: {
  user: string; owner: string; repo: string; path: string;
  harness: Harness; task: string; model?: string; commit?: string;
  exec?: Exec; log?: (s: string) => void;
}): Promise<Result> {
  const { user, owner, repo, path } = opts;
  const log = opts.log ?? (() => {});
  const exec = opts.exec ?? execCommand;
  const file = `/api/repos/${owner}/${repo}/do`, q = `?path=${encodeURIComponent(path)}`;
  const get = async () => {
    const res = await call(user, `${file}/file${q}`);
    if (!res.ok) throw new Error(`read ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as Doc;
  };

  // 1. Snapshot the file and write it to a scratch dir.
  const snapshot = await get();
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-agent-"));
  try {
    writeFileSync(join(dir, path), toDisk(snapshot.lines));

    // 2. Let the agent edit it.
    const cmd = harnessCommand(opts.harness, taskPrompt(path, opts.task), { model: opts.model });
    log(`${opts.harness}: working on ${path} (rev ${snapshot.rev})`);
    const run = await exec(cmd, dir);
    if (run.code !== 0) throw new Error(`${opts.harness} exited ${run.code}:\n${run.out.trim().slice(-2000)}`);
    if (!existsSync(join(dir, path))) throw new Error(`${opts.harness} removed ${path}`);

    // 3. Diff what it left against the snapshot, and post the change.
    const next = fromDisk(readFileSync(join(dir, path), "utf8"));
    const ops = diffToOps(snapshot.lines, next);
    let applied = 0, skipped: Op[] = [], rev = snapshot.rev;
    if (ops.length) {
      // The file may have moved while the agent worked: keep the ops whose lines are unchanged, post them, and retry on a race.
      let landed = false;
      for (let attempt = 0; attempt < 3 && !landed; attempt++) {
        const current = await get();
        const r = rebase(ops, current);
        skipped = r.skipped;
        if (!r.ops.length) { rev = current.rev; landed = true; break; }
        const res = await call(user, `${file}/ops${q}`, { method: "POST", body: JSON.stringify({ ops: r.ops }) });
        if (res.ok) {
          const body = (await res.json()) as { rev: number; applied: unknown[] };
          applied = body.applied.length;
          rev = body.rev;
          landed = true;
        } else if (res.status !== 409) throw new Error(`ops: ${res.status} ${await res.text()}`);
      }
      if (!landed) throw new Error(`${path} kept changing while ${opts.harness} worked; nothing was posted`);
    }
    if (opts.commit && applied) {
      const res = await call(user, `${file}/commit${q}`, { method: "POST", body: JSON.stringify({ message: opts.commit }) });
      if (!res.ok) throw new Error(`commit: ${res.status} ${await res.text()}`);
    }
    return { harness: opts.harness, path, changed: ops.length > 0, applied, skipped, rev, output: run.out.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
