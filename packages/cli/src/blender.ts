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

/** Runs a Python script in headless Blender; resolves to its stdout and stderr, or throws with why it failed. */
export async function runBlender(run: BlenderRun): Promise<{ out: string; err: string }> {
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
  const decoder = new TextDecoder();
  let all = "", rest = "";
  for await (const bytes of stream) {
    const chunk = decoder.decode(bytes, { stream: true });
    all += chunk;
    const parts = (rest + chunk).split("\n");
    rest = parts.pop()!;
    for (const l of parts) onLine(l);
  }
  if (rest) onLine(rest);
  return all;
}
