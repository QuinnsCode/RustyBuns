// Bun's own terminal (`Bun.spawn({ terminal })`): a real PTY with no node-pty, which
// agent terminals lean on. Runs everywhere `bun test packages` does, and on Windows on
// Arm in windows-arm.yml, where it's backed by ConPTY (Bun 1.4+).
import { expect, test } from "bun:test";

const win = process.platform === "win32";
const NL = win ? "\r\n" : "\n";

function spawn(cmd: string[], cols = 80, rows = 24) {
  let out = "";
  const decoder = new TextDecoder();
  const proc = Bun.spawn(cmd, {
    env: { ...process.env, TERM: "xterm-256color" },
    terminal: { cols, rows, data: (_t, bytes) => { out += decoder.decode(bytes, { stream: true }); } },
  });
  return { proc, out: () => out };
}

/** The shell's own output, without the escape sequences a terminal adds around it. */
const plain = (s: string) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "");

test("runs a command and hands back its output and exit code", async () => {
  const { proc, out } = spawn(win ? ["cmd.exe", "/d", "/c", "echo pty-ok& exit 3"] : ["/bin/sh", "-c", "printf pty-ok; exit 3"]);
  expect(await proc.exited).toBe(3);
  await Bun.sleep(50);
  expect(plain(out())).toContain("pty-ok");
});

test("is interactive: takes typed input and resizes", async () => {
  const { proc, out } = spawn(win ? ["cmd.exe", "/d", "/q"] : ["/bin/sh"]);
  proc.terminal!.resize(100, 40);
  // Give the shell a moment to start before typing, as a person would.
  await Bun.sleep(win ? 1500 : 200);
  proc.terminal!.write((win ? "mode con" : "stty size") + NL + "echo typed-ok" + NL + "exit" + NL);
  await proc.exited;
  await Bun.sleep(50);
  const text = plain(out());
  expect(text).toContain("typed-ok");
  expect(text).toMatch(win ? /Columns:\s+100/ : /40 100/);
}, 20_000);

test("kill stops it", async () => {
  const { proc } = spawn(win ? ["cmd.exe", "/d", "/c", "ping -n 30 127.0.0.1 >NUL"] : ["/bin/sh", "-c", "sleep 30"]);
  await Bun.sleep(200);
  proc.kill();
  await proc.exited;
  expect(proc.killed).toBe(true);
}, 20_000);
