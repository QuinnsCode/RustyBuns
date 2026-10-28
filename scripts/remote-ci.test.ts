import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { main, parseJobs, pool, snapshot } from "./remote-ci.ts";

test("reads the touched suites and skips apps with no test command", () => {
  const out = `apps=${JSON.stringify({ include: [{ app: "a", test: "bun test", prep: "" }, { app: "b", test: "", prep: "" }] })}\nany=true\n`;
  expect(parseJobs(out).map((j) => j.app)).toEqual(["a"]);
  expect(() => parseJobs("any=false")).toThrow();
});

test("the pool never runs more than the cap and returns the worst code", async () => {
  let live = 0, peak = 0;
  const worst = await pool([0, 1, 0, 2, 0, 0], 2, async (code) => {
    peak = Math.max(peak, ++live);
    await Bun.sleep(5);
    live--;
    return code;
  });
  expect(worst).toBe(2);
  expect(peak).toBe(2);
});

// The builder is a folder of slot clones; "ssh" is a script that runs the command in that folder's home.
test("a run sends the working tree, untracked files too, to a free slot and gives it back", async () => {
  const root = mkdtempSync(`${tmpdir()}/remote-ci-`), work = `${root}/work`, home = `${root}/home`;
  const id = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  await Bun.write(`${work}/package.json`, `{"name":"w"}`);
  await Bun.$`git init -q && git add -A && git commit -qm one`.cwd(work).env({ ...process.env, ...id });
  await Bun.$`mkdir -p ${home}/builder/locks && git clone -q ${work} ${home}/builder/slot-1`;
  const ssh = `${root}/ssh`;
  await Bun.write(ssh, `#!/bin/sh\nshift\ncd "${home}" && exec sh -c "$*"\n`);
  chmodSync(ssh, 0o755);
  const saved = { ...process.env };
  Object.assign(process.env, id, { BUILDER_HOST: "max", BUILDER_SSH: ssh, GIT_SSH_VARIANT: "simple" });
  try {
    await Bun.write(`${work}/new.txt`, "hello");
    expect(await main(["run", ".", "cat", "new.txt"], work)).toBe(0);
    expect(await Bun.file(`${home}/builder/slot-1/new.txt`).text()).toBe("hello");
    expect(await main(["run", ".", "false"], work)).toBe(1);
    expect(readdirSync(`${home}/builder/locks`)).toEqual([]);
    expect((await Bun.$`git status --porcelain`.cwd(work).text()).trim()).toBe("?? new.txt");
  } finally {
    process.env = saved;
  }
}, 30000);

// Every agent works in a linked worktree, where git gives the index path in full, not relative to the folder.
test("a snapshot works from a linked worktree and sees its untracked files", async () => {
  const root = mkdtempSync(`${tmpdir()}/snap-`);
  const sh = (cwd: string, cmd: string) => Bun.$`sh -c ${cmd}`.cwd(cwd).quiet();
  await sh(root, "git init -q main && cd main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git worktree add -q ../wt");
  await Bun.write(`${root}/wt/new.txt`, "hi");
  const commit = await snapshot(`${root}/wt`);
  expect((await sh(`${root}/main`, `git show ${commit}:new.txt`)).text()).toBe("hi");
});
