"use server";
// Runs on the desktop host: things a browser tab can't do on its own.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TsEngine, type FmEngine } from "../engine/engine.ts";
import { createNativeEngine } from "../engine/native.ts";
import { renderProject } from "../engine/offline.ts";
import { sanitize } from "../project.ts";

const dir = () => process.env.FM_DAW_DIR ?? join(homedir(), "Music", "FM DAW");

/** Write a bounce into ~/Music/FM DAW and return its path. */
export async function saveBounce(name: string, wavBase64: string): Promise<string> {
  const safe = name.replace(/[^\w .-]+/g, "").trim().slice(0, 60) || "bounce";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  await mkdir(dir(), { recursive: true });
  const path = join(dir(), `${safe} ${stamp}.wav`);
  await writeFile(path, Buffer.from(wavBase64, "base64"));
  return path;
}

/** Show a saved file in Finder / Explorer / the file manager. */
export async function reveal(path: string): Promise<void> {
  if (!path.startsWith(dir())) throw new Error("can only reveal bounces");
  const cmd = process.platform === "darwin" ? ["open", "-R", path]
    : process.platform === "win32" ? ["explorer", `/select,${path}`]
    : ["xdg-open", dir()];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

export interface HostBench { platform: string; rustX: number | null; tsX: number }

/** Render the current groove on the host: Rust over bun:ffi, then TS under Bun. */
export async function benchOnHost(project: unknown, seconds: number): Promise<HostBench> {
  const p = sanitize(project);
  if (!p) throw new Error("bad project");
  const secs = Math.min(Math.max(seconds, 1), 60);
  const time = (e: FmEngine) => {
    const t0 = performance.now();
    renderProject(e, p, 48000, secs, 0.5);
    const x = secs / ((performance.now() - t0) / 1000);
    e.free?.();
    return x;
  };
  const rust = await createNativeEngine(48000);
  const rustX = rust ? time(rust) : null;
  return { platform: `${process.platform}-${process.arch}`, rustX, tsX: time(new TsEngine(48000)) };
}
