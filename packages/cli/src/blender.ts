// Headless Blender, one way for every script: `blender -b --factory-startup --python-exit-code 1 [-t n] -P script -- args`.
// stdout and stderr are drained together (a full pipe stalls Blender), and a failed run throws with the
// Traceback and Error lines, so the caller sees why and not a wall of Blender's own chatter.

import { existsSync } from "node:fs";
import { basename } from "node:path";

const CANDIDATES: Record<string, string[]> = {
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender"],
  win32: ["C:\\Program Files\\Blender Foundation\\Blender\\blender.exe"],
  linux: ["/usr/bin/blender", "/snap/bin/blender"],
};

/** Blender's executable, or null. BLENDER_PATH wins, then PATH (so a build uses the Blender it always did), then the usual install places. */
export function findBlender(): string | null {
  const env = process.env.BLENDER_PATH;
  if (env && existsSync(env)) return env;
  return Bun.which("blender") ?? (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p)) ?? null;
}

export interface BlenderRun {
  /** The Python file handed to `-P`. */
  script: string;
  /** What the script reads after `--`. */
  args?: string[];
  cwd?: string;
  /** Added to this process's environment. */
  env?: Record<string, string>;
  /** `-t`: pin it where the thread count changes the output (the beast decimator). */
  threads?: number;
  /** The exact Blender (`5.2.0`) whose output is committed: another one throws before it runs. A point release
   *  can change the bytes (5.2.1's glTF exporter writes vertex colours as 16-bit, 5.2.0's as floats, #4129). */
  version?: string;
  /** Each stdout line as it comes, for a long run that reports progress. */
  onLine?: (line: string) => void;
}

/** The lines of a failed run worth reading: the traceback and errors, or its tail when there are none. */
export function blenderFailure(log: string): string {
  const lines = log.split("\n");
  const picked = lines.filter((l) => /Error|Traceback|line \d+/.test(l));
  return (picked.length ? picked : lines.slice(-25)).join("\n").trim();
}

/** A Mac that hands its heavy work to a builder (BUILDER_HOST set: the office Mac) never starts Blender itself: it
 *  crashed that Mac (2026-11-23). Its scripts go through the Blender queue (scripts/blender-queue.ts, #6007). */
function notHere(instead: string) {
  if (process.env.BUILDER_HOST && !process.env.BLENDER_JOB)
    throw new Error(`Blender doesn't run on this Mac (BUILDER_HOST is set: the builder Mac runs it, one job at a time). Instead: ${instead}`);
}

/** Runs a Python script in headless Blender; resolves to its stdout and stderr, or throws with why it failed. */
export async function runBlender(run: BlenderRun): Promise<{ out: string; err: string }> {
  notHere(`bun run blender add ${run.script} ${(run.args ?? []).join(" ")} --out <dir>`);
  const exe = findBlender();
  if (!exe) throw new Error("no Blender: install it or set BLENDER_PATH");
  if (run.version) {
    const have = await blenderVersion(exe);
    if (have !== run.version) throw new Error(`${basename(run.script)} needs Blender ${run.version}, and ${exe} is ${have ?? "unknown"}: its GLBs would differ from the committed ones. Install ${run.version} (or point BLENDER_PATH at it), or move every Mac to ${have} and rebuild them all.`);
  }
  const cmd = [exe, "-b", "--factory-startup", "--python-exit-code", "1", ...(run.threads ? ["-t", String(run.threads)] : []), "-P", run.script, "--", ...(run.args ?? [])];
  const p = Bun.spawn(cmd, { cwd: run.cwd, env: { ...process.env, ...run.env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([lines(p.stdout, run.onLine), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`blender ${basename(run.script)} ${(run.args ?? []).join(" ")} failed (exit ${code}):\n${blenderFailure(out + "\n" + err)}`);
  return { out, err };
}

const versions = new Map<string, Promise<string | null>>();
/** `Blender 5.2.0 LTS` -> `5.2.0`, asked once per executable. */
export function blenderVersion(exe: string): Promise<string | null> {
  let v = versions.get(exe);
  if (!v) {
    v = new Response(Bun.spawn([exe, "-b", "--factory-startup", "--version"], { stdout: "pipe", stderr: "ignore" }).stdout).text().then((t) => /Blender (\d+\.\d+\.\d+)/.exec(t)?.[1] ?? null);
    versions.set(exe, v);
  }
  return v;
}

async function lines(stream: ReadableStream<Uint8Array>, onLine?: (line: string) => void): Promise<string> {
  if (!onLine) return new Response(stream).text();
  let all = "";
  await eachLine(stream, (l) => { all += l + "\n"; onLine(l); });
  return all;
}

/** The named calls and their arguments (`blender-warm.py` says what each does). Paths are under the Blender's `cwd`. */
export interface WarmCalls {
  load: { glb: string; /** the GLB itself, base64: for a Blender on another Mac */ bytes?: string };
  stats: { part?: string };
  render: { view?: string | { yaw: number; pitch: number }; size?: number; part?: string };
  build: { script: string; args?: string[]; env?: { [name: string]: string } };
  ping: { [k in never]: never };
}

/** What a warm Blender says when it is up, and what `ping` answers. */
export interface WarmInfo { blender: string; peak_mb: number; pid: number; root: string }

export interface WarmBlender {
  /** The running Blender's version, its peak memory so far, its pid (on the Mac it runs on) and the folder its calls may read. */
  info: WarmInfo;
  /** One named call; resolves to its answer (check it) or throws its error. Calls run one at a time, in order. */
  call<K extends keyof WarmCalls>(name: K, args?: WarmCalls[K]): Promise<unknown>;
  /** Ends it: stdin closes and Blender exits on its own; one that hasn't in 5 s is killed. */
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface WarmRun {
  /** The folder every path in a call is under (`load`'s GLB, `build`'s script). Defaults to this process's cwd; on a host, the remote folder (its `$TMPDIR` when unset). */
  cwd?: string;
  threads?: number;
  /** As `runBlender`'s: an exact version, checked before it starts (here only; a host's is in `info.blender`). */
  version?: string;
  /** An ssh name: Blender runs there (the builder Mac), and the calls go over ssh's stdin. */
  host?: string;
  ssh?: string[];
  /** Blender's own chatter and tracebacks, line by line. */
  onLog?: (line: string) => void;
}

const WARM_SCRIPT = new URL("./blender-warm.py", import.meta.url);
// The one line run with --python-expr: it reads the server's source as the first line on stdin (a JSON string), so a
// remote Blender needs no copy of this repo; every later line is a call.
const BOOT = "import sys,json;exec(compile(json.loads(sys.stdin.readline()),'blender-warm.py','exec'))";
const MARK = "@@warm ";
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A long-running headless Blender that takes named calls (never Python it is sent), so a second build or a look at a
 * model skips the cold start. It lives as long as its stdin: close it, or let this process exit (the pipe, and an ssh,
 * closes with it), and Blender stops, so it can't outlive the session. `await using b = await warmBlender({...})`.
 */
export async function warmBlender(run: WarmRun = {}): Promise<WarmBlender> {
  const args = ["-b", "--factory-startup", "--python-exit-code", "1", ...(run.threads ? ["-t", String(run.threads)] : []), "--python-expr", BOOT];
  let cmd: string[];
  if (run.host) {
    const exe = `"$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)"`;
    const dir = run.cwd ? quote(run.cwd) : `"$TMPDIR"`;
    cmd = [...(run.ssh ?? ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]), run.host,
      `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; cd ${dir} && exec ${exe} ${args.map(quote).join(" ")}`];
  } else {
    notHere("a warm Blender on the builder: warmBlender({ host: process.env.BUILDER_HOST })");
    const exe = findBlender();
    if (!exe) throw new Error("no Blender: install it or set BLENDER_PATH");
    if (run.version) {
      const have = await blenderVersion(exe);
      if (have !== run.version) throw new Error(`a warm Blender ${run.version} was asked for, and ${exe} is ${have ?? "unknown"}`);
    }
    cmd = [exe, ...args];
  }
  const p = Bun.spawn(cmd, { cwd: run.host ? undefined : run.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const log: string[] = [];
  const note = (l: string) => { log.push(l); if (log.length > 200) log.shift(); run.onLog?.(l); };
  const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  let ended: Error | null = null;
  const fail = (e: Error) => { ended ??= e; for (const w of waiting.values()) w.fail(e); waiting.clear(); };

  void eachLine(p.stdout, (l) => {
    if (!l.startsWith(MARK)) return note(l);
    let msg: unknown;
    try { msg = JSON.parse(l.slice(MARK.length)); } catch { return note(l); }
    if (typeof msg !== "object" || msg === null || !("id" in msg) || typeof msg.id !== "number") return note(l);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if ("ok" in msg && msg.ok === true) w.ok("value" in msg ? msg.value : null);
    else w.fail(new Error("error" in msg && typeof msg.error === "string" ? msg.error : `call ${msg.id} failed`));
  });
  void eachLine(p.stderr, note);
  void p.exited.then((code) => fail(new Error(`warm Blender exited (${code}):\n${blenderFailure(log.join("\n"))}`)));

  let next = 0;
  const send = (line: string) => { p.stdin.write(line + "\n"); p.stdin.flush(); };
  const reply = (id: number) => new Promise<unknown>((ok, fail) => ended ? fail(ended) : waiting.set(id, { ok, fail }));
  const call = <K extends keyof WarmCalls>(name: K, args?: WarmCalls[K]) => {
    const id = ++next, answer = reply(id);
    if (!ended) send(JSON.stringify({ id, call: name, args: args ?? {} }));
    return answer;
  };
  const close = async () => {
    if (p.exitCode !== null || p.signalCode !== null) return;
    p.stdin.end();
    const timer = setTimeout(() => p.kill("SIGKILL"), 5000);
    await p.exited;
    clearTimeout(timer);
  };

  const ready = reply(0);
  send(JSON.stringify(await Bun.file(WARM_SCRIPT).text()));
  const info = await ready.catch(async (e: unknown) => { await close(); throw e; });
  if (typeof info !== "object" || info === null || !("blender" in info) || typeof info.blender !== "string"
    || !("peak_mb" in info) || typeof info.peak_mb !== "number" || !("pid" in info) || typeof info.pid !== "number"
    || !("root" in info) || typeof info.root !== "string") {
    await close();
    throw new Error("a warm Blender answered its first line with something else");
  }
  return { info: { blender: info.blender, peak_mb: info.peak_mb, pid: info.pid, root: info.root }, call, close, [Symbol.asyncDispose]: close };
}

async function eachLine(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder(), reader = stream.getReader();
  let rest = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    const parts = (rest + decoder.decode(r.value, { stream: true })).split("\n");
    rest = parts.pop()!;
    for (const l of parts) onLine(l);
  }
  if (rest) onLine(rest);
}
