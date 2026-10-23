// What a desktop binary embeds of the client build: the files a page asks for. Source maps stay out
// (only DevTools fetches them, but a download carries every byte; `desktop.sourceMaps: true` keeps
// them), so does what `.assetsignore` names (Cloudflare leaves those out of an upload), and so do
// binaries an earlier build wrote into the same folder (a worker-mode app whose assets are `dist/`).
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { assetIgnore } from "@rustybuns/shell-bun/assetsignore";

export type Staged = { files: number; maps: number; ignored: number; binaries: number };

/**
 * Copy `src` to `dest` (hard links where the filesystem allows) without what a binary shouldn't
 * carry. `binaryPrefix` is `<app name>-`: top-level `<name>-darwin-arm64` and the like are skipped.
 */
export function stageAssets(src: string, dest: string, opts: { keepMaps?: boolean; binaryPrefix?: string } = {}): Staged {
  const ignoreFile = join(src, ".assetsignore");
  const ignored = existsSync(ignoreFile) ? assetIgnore(readFileSync(ignoreFile, "utf8")) : () => false;
  const binary = opts.binaryPrefix
    ? new RegExp(`^${opts.binaryPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(darwin|linux|windows)-(arm64|x64)(-baseline)?(\\.exe)?$`)
    : null;
  const out: Staged = { files: 0, maps: 0, ignored: 0, binaries: 0 };
  rmSync(dest, { recursive: true, force: true });
  for (const e of readdirSync(src, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[]) {
    if (!e.isFile()) continue;
    const from = join(e.parentPath ?? (e as any).path, e.name);
    const rel = from.slice(src.length).replace(/^[\\/]+/, "").replaceAll("\\", "/");
    if (rel === ".assetsignore") continue;
    if (!opts.keepMaps && rel.endsWith(".map")) { out.maps++; continue; }
    if (binary && !rel.includes("/") && binary.test(rel)) { out.binaries++; continue; }
    if (ignored(rel)) { out.ignored++; continue; }
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    try { linkSync(from, to); } catch { copyFileSync(from, to); }
    out.files++;
  }
  return out;
}
