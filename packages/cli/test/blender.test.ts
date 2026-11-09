import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBlender } from "../src/blender.ts";

// A stand-in Blender (BLENDER_PATH, so CI needs none): it prints its arguments, and with `boom` after `--`
// it fails the way Blender does on a Python error, chatter first, then the traceback on stderr.
const dir = mkdtempSync(join(tmpdir(), "fake-blender-"));
const fake = join(dir, "blender");
writeFileSync(fake, `#!/bin/sh
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
