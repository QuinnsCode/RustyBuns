// Git LFS for trial-github: a shallow clone of a repo that keeps images in LFS holds only the small
// pointer files. With git-lfs installed `git lfs pull` swaps them; without it each pointer is fetched
// from media.githubusercontent.com, which serves the real file for a path at a commit.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

export const LFS_CAP = 200 * 1024 * 1024;

/** The size an LFS pointer file declares, or undefined when the text isn't a pointer. */
export function pointerSize(text: string): number | undefined {
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1\n")) return undefined;
  if (!/^oid sha256:[0-9a-f]{64}$/m.test(text)) return undefined;
  const size = text.match(/^size (\d+)$/m)?.[1];
  return size === undefined ? undefined : Number(size);
}

/** Pointer files in the clone, as repo-relative path and declared size. Pointers are under 1 KB, so only small files are read. */
export async function lfsPointers(root: string): Promise<{ path: string; size: number }[]> {
  const attrs = join(root, ".gitattributes");
  if (!existsSync(attrs) || !/filter=lfs/.test(readFileSync(attrs, "utf8"))) return [];
  const files = (await $`git -C ${root} ls-files -z`.quiet().nothrow().text()).split("\0").filter(Boolean);
  const out: { path: string; size: number }[] = [];
  for (const path of files) {
    try {
      if (statSync(join(root, path)).size > 1024) continue;
      const size = pointerSize(readFileSync(join(root, path), "utf8"));
      if (size !== undefined) out.push({ path, size });
    } catch { /* a dangling symlink or a submodule dir */ }
  }
  return out;
}

/** Replaces the clone's LFS pointers with the real files. Returns a line per outcome for the trial's log and report. */
export async function fetchLfs(repo: string, root: string, cap = LFS_CAP, get: typeof fetch = fetch): Promise<string[]> {
  const pointers = await lfsPointers(root);
  if (!pointers.length) return [];
  if ((await $`git lfs version`.quiet().nothrow()).exitCode === 0) {
    const pulled = await $`git -C ${root} lfs pull`.quiet().nothrow();
    return [pulled.exitCode === 0 ? `git lfs pull: ${pointers.length} files` : `git lfs pull failed: ${pulled.stderr.toString().trim().split("\n").at(-1)}`];
  }
  const sha = (await $`git -C ${root} rev-parse HEAD`.quiet().text()).trim();
  const lines: string[] = [];
  let total = 0;
  for (const { path, size } of pointers) {
    if (total + size > cap) { lines.push(`skipped ${path}: ${size} bytes would pass the ${cap} byte cap`); continue; }
    try {
      const res = await get(`https://media.githubusercontent.com/media/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`);
      if (!res.ok) { lines.push(`failed ${path}: HTTP ${res.status}`); continue; }
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.length !== size) { lines.push(`failed ${path}: got ${body.length} bytes, pointer says ${size}`); continue; }
      writeFileSync(join(root, path), body);
      total += size;
      lines.push(`fetched ${path} (${size} bytes)`);
    } catch (e) { lines.push(`failed ${path}: ${(e as Error).message}`); }
  }
  return lines;
}
