// @rustybuns/native
// loadNative(name, symbols): dlopen the right cdylib for this platform, or
// null. Null is a capability signal, not an error: the app takes the TS path.
//
// Search order:
//   1. opts.dir
//   2. native/dist/<name>/<platform>-<arch>/     (dev, after `cargo build`)
//   3. /$bunfs/root/<name>/<platform>-<arch>/    (compiled binary, --asset)
// dlopen can't map a file inside the binary, so (3) copies it to a cache dir
// keyed by content hash on first run.

import { dlopen, type FFIFunction, type ConvertFns } from "bun:ffi";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LoadOptions { dir?: string; cacheDir?: string; }

function libFile(name: string): string {
  return process.platform === "win32" ? `${name}.dll`
    : process.platform === "darwin" ? `lib${name}.dylib`
    : `lib${name}.so`;
}

export const platformTag = () => `${process.platform}-${process.arch}`;

function candidates(name: string, opts: LoadOptions): string[] {
  const f = libFile(name);
  const tag = platformTag();
  return [
    opts.dir && join(opts.dir, f),
    join(process.cwd(), "native", "dist", name, tag, f),
    join(import.meta.dir, "..", "..", "..", "native", "dist", name, tag, f),
    join("/$bunfs/root", name, tag, f),
    join("/$bunfs/root", tag, f),
  ].filter(Boolean) as string[];
}

async function materialize(path: string, opts: LoadOptions): Promise<string> {
  if (!path.startsWith("/$bunfs")) return path;
  const bytes = await Bun.file(path).arrayBuffer();
  const hash = Bun.hash(bytes).toString(16);
  const dir = opts.cacheDir ?? join(homedir(), ".cache", "rustybuns");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${hash}-${path.split("/").pop()}`);
  if (!existsSync(out)) copyFileSync(path, out);
  return out;
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
