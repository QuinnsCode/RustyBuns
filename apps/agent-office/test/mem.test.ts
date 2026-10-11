import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { officeMem, ptyHostMem, PTY_MEM_FILE } from "../live/mem.ts";

test("a pty host leaves its latest sample beside its info file, and the office reads every floor's", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rb-mem-"));
  const floor = (id: string) => ({ id, dir: path.join(dir, id) });
  const [a, b] = [floor("a"), floor("b")];
  for (const f of [a, b]) mkdirSync(path.join(f.dir, ".agent-office"), { recursive: true });

  const watch = ptyHostMem(path.join(a.dir, ".agent-office", "pty-host.json"), () => 1234)!;
  watch.stop();
  const wrote = JSON.parse(readFileSync(path.join(a.dir, ".agent-office", PTY_MEM_FILE), "utf8"));
  expect(wrote).toMatchObject({ pid: process.pid, at: 1234, samples: 1 });
  expect(wrote.rssMb).toBeGreaterThan(0);
  // a torn write reads as no sample yet, not an error
  writeFileSync(path.join(b.dir, ".agent-office", PTY_MEM_FILE), "{");

  const stats = officeMem(dir, () => [a, b])();
  expect(stats.office.rssMb).toBeGreaterThan(0);
  expect(stats.ptyHosts).toEqual([{ floor: "a", mem: wrote }, { floor: "b", mem: null }]);
});

test("no info file, no pty host watch", () => {
  expect(ptyHostMem(undefined)).toBeUndefined();
});
