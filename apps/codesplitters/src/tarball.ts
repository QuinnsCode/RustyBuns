// A repo's tip out of GitHub's tarball, for the repos Cloudflare Artifacts
// won't import: its import stops at 40 MB even at depth 1 (code 10402,
// MEMORY_LIMIT; #334). So: make an empty Artifact, read the tarball, and push
// its tree as one commit (git.ts), in as many packs as that takes. Same
// files, modes, symlinks and submodules as the tip (a tarball leaves
// submodules out, so they're passed in), less anything the repo marks
// export-ignore.

import { pushTree, type TreeFile } from "./git.ts";
import { code, type Artifacts } from "./env.ts";

/** Did an Artifacts import refuse this repo for being over its 40 MB cap? */
export const tooBigToImport = (e: unknown) => code(e) === "MEMORY_LIMIT" || /\b10402\b|import limit/.test(String((e as Error)?.message ?? e));

/**
 * How big a pack gets before it goes out on its own: a big repo (Bun) goes
 * in several, so one pack, the tarball streaming through and the tree all fit
 * a Worker's 128 MB (#347).
 */
export const PACK_BYTES = 32 * 2 ** 20;

/** Pulls exact byte counts off a stream. */
function reader(stream: ReadableStream<Uint8Array>) {
  const r = stream.getReader();
  let buf = new Uint8Array(0);
  return async (n: number): Promise<Uint8Array | null> => {
    if (buf.length < n) {
      // Gather chunks and join once: a big file arrives in many.
      const parts: Uint8Array[] = [buf];
      let have = buf.length;
      while (have < n) {
        const { value, done } = await r.read();
        if (done) { if (have) throw new Error("tar: cut short"); return null; }
        parts.push(value);
        have += value.length;
      }
      buf = new Uint8Array(have);
      let o = 0;
      for (const p of parts) { buf.set(p, o); o += p.length; }
    }
    const out = buf.slice(0, n);
    buf = buf.subarray(n);
    return out;
  };
}

const dec = new TextDecoder();
const str = (b: Uint8Array, at: number, len: number) => { const s = b.subarray(at, at + len), z = s.indexOf(0); return dec.decode(z < 0 ? s : s.subarray(0, z)); };
const octal = (b: Uint8Array, at: number, len: number) => parseInt(str(b, at, len).trim() || "0", 8);

/** pax records ("<len> key=value\n") as a map. */
function pax(b: Uint8Array) {
  const out = new Map<string, string>();
  for (let o = 0; o < b.length;) {
    const sp = b.indexOf(0x20, o);
    if (sp < 0) break;
    const len = parseInt(dec.decode(b.subarray(o, sp)), 10);
    if (!len) break;
    const kv = dec.decode(b.subarray(sp + 1, o + len - 1)), eq = kv.indexOf("=");
    out.set(kv.slice(0, eq), kv.slice(eq + 1));
    o += len;
  }
  return out;
}

/**
 * The files in a tar stream (ustar, with pax and GNU long names), each path
 * without its first segment: GitHub puts everything under "owner-repo-sha/".
 */
export async function* tarFiles(stream: ReadableStream<Uint8Array>): AsyncGenerator<TreeFile> {
  const read = reader(stream);
  let next: { path?: string; link?: string } = {};
  for (;;) {
    const h = await read(512);
    if (!h || h.every((x) => x === 0)) return;
    const size = octal(h, 124, 12), type = String.fromCharCode(h[156]!);
    const body = size ? (await read(Math.ceil(size / 512) * 512))?.subarray(0, size) : new Uint8Array(0);
    if (!body) throw new Error("tar: cut short");
    if (type === "x") { const p = pax(body); next = { path: p.get("path") ?? next.path, link: p.get("linkpath") ?? next.link }; continue; }
    if (type === "L") { next.path = str(body, 0, size); continue; }
    if (type === "K") { next.link = str(body, 0, size); continue; }
    const prefix = str(h, 345, 155), name = next.path ?? (prefix ? `${prefix}/` : "") + str(h, 0, 100);
    const link = next.link ?? str(h, 157, 100);
    next = {};
    const path = name.split("/").slice(1).join("/");
    if (!path || path.endsWith("/")) continue;
    if (type === "0" || type === "\0" || type === "7") yield { path, mode: octal(h, 100, 8) & 0o100 ? "100755" : "100644", data: body };
    else if (type === "2") yield { path, mode: "120000", data: new TextEncoder().encode(link) };
    // Directories, global headers ("g") and the rest carry no files.
  }
}

/** Is this Artifacts name still held, by a repo being deleted or a import being given up on? */
const held = (e: unknown) => code(e) === "ALREADY_EXISTS" || /already exists|being imported/i.test(String((e as Error)?.message ?? e));

/** Run `make` until the name it wants is free, for up to about `tries` seconds. */
export async function whenFree<T>(make: () => Promise<T>, tries = 30, gapMs = 1000): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await make(); } catch (e) {
      if (!held(e) || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}

/**
 * Make Artifact `target.name` hold `repo` at `sha`, from GitHub's tarball, as
 * one commit. A read-only target is filled through a writable one first,
 * since nobody can push to a read-only repo.
 */
export async function importTarball(ns: Artifacts, p: {
  tarball: () => Promise<Response>; submodules?: () => Promise<{ path: string; commit: string }[]>; repo: string; sha: string; branch: string; message: string; author: string; email?: string; at?: number; packBytes?: number;
  target: { name: string; opts?: { description?: string; readOnly?: boolean } };
}): Promise<{ name: string; remote: string; defaultBranch: string }> {
  const ro = p.target.opts?.readOnly === true, name = ro ? `${p.target.name}-tip` : p.target.name;
  if (ro) await ns.delete?.(name).catch(() => false);   // a leftover from a try that died halfway
  // On Cloudflare the import that just refused it leaves its half-made target behind, and a delete
  // takes a few seconds to free the name, so clear it and wait for the name (#348).
  await ns.delete?.(p.target.name).catch(() => false);
  const made = await whenFree(() => ns.create(name, { description: p.target.opts?.description, setDefaultBranch: p.branch }));
  try {
    const res = await p.tarball();
    if (!res.ok || !res.body) throw new Error(`GitHub said ${res.status} for ${p.repo}'s tarball`);
    const token = (made as { token?: string }).token || (await (await ns.get(name)).createToken("write", 3600)).plaintext;
    const body = res.body;
    async function* files(): AsyncGenerator<TreeFile> {
      yield* tarFiles(body.pipeThrough(new DecompressionStream("gzip")));
      for (const m of (await p.submodules?.()) ?? []) yield { path: m.path, mode: "160000", commit: m.commit };
    }
    await pushTree(made.remote, token, files(), {
      message: `${p.message}\n\n${p.repo} at ${p.sha}, from GitHub's tarball: too big for an Artifacts import.`,
      author: p.author, email: p.email, branch: p.branch, at: p.at, packBytes: p.packBytes ?? PACK_BYTES,
    });
    if (!ro) return made;
    const art = await whenFree(async () => (await ns.get(name)).fork(p.target.name, { description: p.target.opts?.description, readOnly: true, defaultBranchOnly: true }));
    await ns.delete?.(name).catch(() => false);
    return art;
  } catch (e) {
    await ns.delete?.(name).catch(() => false);
    throw e;
  }
}
