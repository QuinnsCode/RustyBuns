import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { officeMem, ptyHostMem, PTY_MEM_FILE, readPtyHostMem } from "../live/mem.ts";

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

test("a pty host that exits takes its sample with it, and one that was killed reads as gone", () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "rb-mem-")), ".agent-office");
  mkdirSync(dir);
  const file = path.join(dir, PTY_MEM_FILE);
  const script = `import { ptyHostMem } from ${JSON.stringify(path.join(import.meta.dir, "../live/mem.ts"))};
ptyHostMem(${JSON.stringify(path.join(dir, "pty-host.json"))});
console.log(require("node:fs").existsSync(${JSON.stringify(file)}));`;
  const child = Bun.spawnSync([process.execPath, "-e", script]);
  expect(child.stdout.toString().trim()).toBe("true");
  expect(existsSync(file)).toBe(false);

  // SIGKILL skips exit handlers: the file stays, but its pid is gone
  writeFileSync(file, JSON.stringify({ rssMb: 1, pid: child.pid, at: 1 }));
  expect(readPtyHostMem(dir)).toBeNull();
  writeFileSync(file, JSON.stringify({ rssMb: 1, pid: process.pid, at: 1 }));
  expect(readPtyHostMem(dir)).toMatchObject({ pid: process.pid });
});
