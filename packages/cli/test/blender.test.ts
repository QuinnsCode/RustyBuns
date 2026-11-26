import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blenderLock, blenderLockHolder, runBlender } from "../src/blender.ts";

// A stand-in Blender (BLENDER_PATH, so CI needs none): it prints its arguments, and with `boom` after `--`
// it fails the way Blender does on a Python error, chatter first, then the traceback on stderr.
const dir = mkdtempSync(join(tmpdir(), "fake-blender-"));
const fake = join(dir, "blender");
writeFileSync(fake, `#!/bin/sh
case "$*" in *--version*) echo "Blender 5.2.0 LTS"; echo "	build hash: abc"; exit 0;; esac
echo "Blender 5.2 (hash abc)"
echo "args: $*"
echo "step=$SNAP_STEP"
case "$*" in *boom*)
  echo "Read prefs: none" >&2
  echo "Traceback (most recent call last):" >&2
  echo '  File "beast.py", line 12, in <module>' >&2
  echo "KeyError: 'horn'" >&2
  exit 1;;
esac
`);
chmodSync(fake, 0o755);
const before = process.env.BLENDER_PATH;
process.env.BLENDER_PATH = fake;
process.env.RUSTYBUNS_HOME = dir; // runBlender takes its one-Blender lock here, not in ~/.rustybuns
afterAll(() => { process.env.BLENDER_PATH = before; rmSync(dir, { recursive: true, force: true }); });

test("a build runs headless with the pinned threads and hands back its output, line by line as it comes", async () => {
  const seen: string[] = [];
  const { out } = await runBlender({ script: "blender/beast.py", args: ["beasts/squonk.json"], env: { SNAP_STEP: "0.01" }, threads: 8, onLine: (l) => seen.push(l) });
  expect(out).toContain("args: -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- beasts/squonk.json");
  expect(out).toContain("step=0.01");
  expect(seen).toEqual(out.trimEnd().split("\n"));
});

test("a Python error throws with its traceback, not Blender's chatter", async () => {
  const e = await runBlender({ script: "blender/beast.py", args: ["boom"] }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(Error);
  const msg = String(e);
  expect(msg).toContain("Traceback (most recent call last):");
  expect(msg).toContain("line 12");
  expect(msg).toContain("KeyError: 'horn'");
  expect(msg).not.toContain("Read prefs");
});

test("a build pinned to a Blender version runs on that one and stops on any other, naming both", async () => {
  const { out } = await runBlender({ script: "blender/beast.py", args: ["beasts/squonk.json"], threads: 8, version: "5.2.0" });
  expect(out).toContain("-t 8 -P blender/beast.py");
  const e = await runBlender({ script: "blender/beast.py", args: ["beasts/squonk.json"], version: "5.2.1" }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(Error);
  expect(String(e)).toContain("needs Blender 5.2.1");
  expect(String(e)).toContain("is 5.2.0");
});

test("on a Mac that hands its heavy work to a builder, it won't start Blender and names the queue line instead", async () => {
  const host = process.env.BUILDER_HOST;
  process.env.BUILDER_HOST = "bob.local";
  try {
    const e = await runBlender({ script: "blender/beast.py", args: ["beasts/squonk.json"] }).catch((x: unknown) => x);
    expect(String(e)).toContain("bun run blender add blender/beast.py beasts/squonk.json");
  } finally {
    if (host === undefined) delete process.env.BUILDER_HOST; else process.env.BUILDER_HOST = host;
  }
});

test("one Blender at a time: a second taker waits for a live holder, takes over a dead one's lock, and nests in one process", async () => {
  const lock = join(dir, "one.lock");
  // a live holder elsewhere (a warm Blender over ssh, a test in another slot): the lock waits until it is gone
  const other = Bun.spawn(["sh", "-c", `mkdir ${lock} && echo $$ > ${lock}/pid && exec sleep 0.6`]);
  while (!existsSync(`${lock}/pid`)) await Bun.sleep(10);
  const waited: number[] = [], t0 = Date.now();
  const release = await blenderLock({ dir: lock, every: 50, onWait: (pid) => waited.push(pid) });
  expect(waited).toEqual([other.pid]);
  expect(Date.now() - t0).toBeGreaterThan(400);
  // the same process again (a warm Blender's own build) doesn't wait on itself
  const inner = await blenderLock({ dir: lock, every: 50, onWait: () => { throw new Error("waited on itself"); } });
  inner();
  expect(blenderLockHolder(lock)).toBe(process.pid);
  release();
  expect(existsSync(lock)).toBe(false);
  // one left by a process that died holding it is taken straight away
  mkdirSync(lock);
  writeFileSync(`${lock}/pid`, String(other.pid));
  (await blenderLock({ dir: lock, every: 50, onWait: () => { throw new Error("waited on a dead holder"); } }))();
});
