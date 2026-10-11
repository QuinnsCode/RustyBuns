// @rustybuns/native
// loadNative(name, symbols): dlopen the right cdylib for this platform, or
// null. Null is a capability signal, not an error: the app takes the TS path.
//
// Search order:
//   1. opts.dir
//   2. native/dist/<name>/<platform>-<arch>/     (dev, after `cargo build`), in the
//      entry script's folder or one above it, up to the nearest package.json
//   3. /$bunfs/root/native/<name>/<platform>-<arch>/  (compiled binary; `rustybuns build desktop` embeds it)
// (2) follows the entry script (Bun.main), never process.cwd(): running a dev
// build from someone else's folder must not dlopen the library sitting there.
// A compiled binary skips (2) and loads only opts.dir or its embedded copy.
// dlopen can't map a file inside the binary, so (3) copies it to a cache dir
// keyed by content hash on first run, and checks a copy already there byte for
// byte before every dlopen: any local process could have swapped it.

import { dlopen, type FFIFunction, type ConvertFns } from "bun:ffi";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface LoadOptions { dir?: string; cacheDir?: string; }

function libFile(name: string): string {
  return process.platform === "win32" ? `${name}.dll`
    : process.platform === "darwin" ? `lib${name}.dylib`
    : `lib${name}.so`;
}

export const platformTag = () => `${process.platform}-${process.arch}`;

// Bun puts a compiled binary's modules under /$bunfs (B:\~BUN on Windows).
export const isCompiled = (here: string) => here.startsWith("/$bunfs") || here.includes("~BUN");

/** The entry script's folder and each one above it, up to the first with a package.json (or the root). */
export function projectDirs(main: string): string[] {
  const dirs: string[] = [];
  for (let d = dirname(main); ; d = dirname(d)) {
    dirs.push(d);
    if (existsSync(join(d, "package.json")) || dirname(d) === d) return dirs;
  }
}

export function candidates(name: string, opts: LoadOptions, here = import.meta.dir, main = Bun.main): string[] {
  const f = libFile(name);
  const tag = platformTag();
  const dev = !isCompiled(here);
  return [
    opts.dir && join(opts.dir, f),
    ...(dev ? projectDirs(main).map((d) => join(d, "native", "dist", name, tag, f)) : []),
    dev && join(here, "..", "..", "..", "native", "dist", name, tag, f),
    join("/$bunfs/root", "native", name, tag, f),   // rustybuns build desktop embeds here
    join("/$bunfs/root", name, tag, f),
    join("/$bunfs/root", tag, f),
  ].filter(Boolean) as string[];
}

async function materialize(path: string, opts: LoadOptions): Promise<string> {
  if (!path.startsWith("/$bunfs")) return path;
  return cacheCopy(new Uint8Array(await Bun.file(path).arrayBuffer()), path.split("/").pop()!, opts);
}

/** The library's bytes as a file dlopen can map: the cached copy, rewritten unless it is exactly these bytes. */
export function cacheCopy(bytes: Uint8Array, file: string, opts: LoadOptions = {}): string {
  const hash = Bun.hash(bytes).toString(16);
  const dir = opts.cacheDir ?? join(homedir(), ".cache", "rustybuns");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = join(dir, `${hash}-${file}`);
  if (!sameBytes(out, bytes)) {
    // copyFileSync can't read /$bunfs; write the bytes we already have. tmp +
    // rename so a second instance never dlopens a half-written file.
    const tmp = `${out}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    chmodSync(tmp, 0o755);
    renameSync(tmp, out);
    if (!sameBytes(out, bytes)) throw new Error(`${out} doesn't match the embedded library`);
  }
  return out;
}

function sameBytes(file: string, bytes: Uint8Array): boolean {
  try { return Buffer.from(bytes).equals(readFileSync(file)); } catch { return false; }
}

export async function loadNative<S extends Record<string, FFIFunction>>(
  name: string, symbols: S, opts: LoadOptions = {},
): Promise<ConvertFns<S> | null> {
  for (const c of candidates(name, opts)) {
    if (!existsSync(c)) continue;
    try {
      const real = await materialize(c, opts);
      return dlopen(real, symbols).symbols;
    } catch (err) {
      console.warn(`[native] ${c}: ${(err as Error).message}`);
    }
  }
  return null;
}
