import { expect, test } from "bun:test";
// @ts-expect-error plain JS shim, no types
import * as pty from "../shim/node-pty/index.js";

type Pty = {
  pid: number;
  onData(cb: (d: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(s: string): void;
  resize(c: number, r: number): void;
};

test("the node-pty shim runs an interactive shell on Bun's PTY", async () => {
  const p: Pty = pty.spawn("/bin/sh", ["-i"], { name: "xterm-256color", cols: 80, rows: 24, cwd: process.env.HOME, env: { ...process.env, PS1: "$ " } });
  expect(p.pid).toBeGreaterThan(0);
  let out = "";
  p.onData((d) => (out += d));
  const exited = new Promise<number>((resolve) => p.onExit((e) => resolve(e.exitCode)));
  p.resize(132, 50);
  p.write("echo 🥐 rusty-$((6*7)); stty size; tty; exit\r");
  expect(await exited).toBe(0);
  expect(out).toContain("🥐 rusty-42");
  expect(out).toContain("50 132");
  expect(out).toMatch(/\/dev\/(ttys?|pts\/)\d*/);
}, 10_000);
