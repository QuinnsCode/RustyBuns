// Layout: a git push with no git library: objects, trees rebuilt only along changed paths, pack, receive-pack
// Push changed files to a git remote over smart HTTP, with no git library:
// build the blobs, rebuild only the trees along changed paths (reading the
// rest from the parent), pack the new objects, and send one receive-pack
// request. Artifacts only takes writes as a git push, and this is
// all a push is. Runs the same in a Worker and under Bun (Web Crypto and
// CompressionStream only).

// The git identity commits are built with keeps its pre-rename spelling for good (#810):
// a commit's hash covers its author line, so renaming these would rebuild every commit
// made afterwards with new hashes, and mirrors would see that as rewritten history.
/** The author of the commits codeSplitter makes on its own. */
export const GIT_BOT = "codesplitters";
/** A crew member without an email of their own commits as `<name>@` this. */
export const GIT_EMAIL_DOMAIN = "codesplitters.local";

import { hex } from "./util.ts";

const enc = new TextEncoder();
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
// Everything here is built in fresh buffers; TS 5.9 wants that spelled out.
type Bytes = Uint8Array<ArrayBuffer>;
const sha1 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-1", b as Bytes));
async function deflate(b: Uint8Array) {
  const s = new Blob([b as Bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const TYPES = { commit: 1, tree: 2, blob: 3 } as const;
export interface Obj { type: keyof typeof TYPES; body: Uint8Array; id: string }

async function obj(type: Obj["type"], body: Uint8Array): Promise<Obj> {
  const id = hex(await sha1(concat([enc.encode(`${type} ${body.length}\0`), body])));
  return { type, body, id };
}

/** The hash git gives `bytes` as a blob. */
export const blobId = async (bytes: Uint8Array) => (await obj("blob", bytes)).id;

/** Reads an existing repo's commits and trees (the Artifacts repo handle has this shape). */
export interface TreeReader {
  readCommit(hash: string): Promise<{ treeHash: string } | null>;
  readTree(hash: string): Promise<{ name: string; mode: string; hash: string; type: string }[] | null>;
}
interface Entry { name: string; mode: string; id: string; dir: boolean }
/** What a path becomes: text, bytes (a binary file, with its mode if not 100644), or null to remove it. */
export type Change = string | { bytes: Uint8Array; mode?: string } | null;

/**
 * The tree at `treeHash` with `changes` applied ({ "a/b.ts": content, "old.ts": null }).
 * Only the trees along changed paths are rebuilt; everything else keeps its
 * hash and stays out of the pack (the remote already has it). Returns null for
 * an empty tree.
 */
async function apply(base: TreeReader | undefined, treeHash: string | null, changes: Record<string, Change>, out: Obj[]): Promise<Obj | null> {
  const entries = new Map<string, Entry>();
  if (treeHash && base) for (const e of (await base.readTree(treeHash)) ?? []) entries.set(e.name, { name: e.name, mode: e.mode, id: e.hash, dir: e.type === "tree" });
  const here: Record<string, Change> = {}, sub: Record<string, Record<string, Change>> = {};
  for (const [path, content] of Object.entries(changes)) {
    const i = path.indexOf("/");
    if (i < 0) here[path] = content;
    else (sub[path.slice(0, i)] ??= {})[path.slice(i + 1)] = content;
  }
  for (const [name, content] of Object.entries(here)) {
    if (content === null) { entries.delete(name); continue; }
    const b = await obj("blob", typeof content === "string" ? enc.encode(content) : content.bytes);
    out.push(b);
    const was = entries.get(name), mode = typeof content === "string" ? undefined : content.mode;
    entries.set(name, { name, mode: mode ?? (was && !was.dir ? was.mode : "100644"), id: b.id, dir: false });
  }
  for (const [name, inner] of Object.entries(sub)) {
    const was = entries.get(name);
    const t = await apply(base, was?.dir ? was.id : null, inner, out);
    if (t) entries.set(name, { name, mode: "40000", id: t.id, dir: true });
    else entries.delete(name);
  }
  if (!entries.size) return null;
  // Git orders a tree as if each directory name ended in "/".
  const key = (e: Entry) => e.name + (e.dir ? "/" : "");
  const sorted = [...entries.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const tree = await obj("tree", concat(sorted.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), unhex(e.id)])));
  out.push(tree);
  return tree;
}

async function pack(objs: Obj[]) {
  const parts: Uint8Array[] = [enc.encode("PACK"), new Uint8Array([0, 0, 0, 2]), new Uint8Array(new Uint32Array([objs.length]).buffer).reverse()];
  for (const o of objs) {
    // Type and size: 3 bits of type, then the size 4 bits first and 7 at a time after.
    let n = o.body.length;
    const head = [(TYPES[o.type] << 4) | (n & 15)];
    n >>= 4;
    while (n > 0) { head[head.length - 1]! |= 0x80; head.push(n & 0x7f); n >>= 7; }
    parts.push(new Uint8Array(head), await deflate(o.body));
  }
  const body = concat(parts);
  return concat([body, await sha1(body)]);
}

const pkt = (s: string) => { const b = enc.encode(s); return concat([enc.encode((b.length + 4).toString(16).padStart(4, "0")), b]); };

/** Read pkt-lines as text (enough for ref adverts and report-status). */
function lines(buf: Uint8Array) {
  const out: string[] = [];
  const dec = new TextDecoder();
  for (let o = 0; o + 4 <= buf.length;) {
    const n = parseInt(dec.decode(buf.subarray(o, o + 4)), 16);
    if (!n) { o += 4; continue; }
    out.push(dec.decode(buf.subarray(o + 4, o + n)).replace(/\n$/, ""));
    o += n;
  }
  return out;
}

export interface Snapshot {
  /** Paths to write (content) or remove (null). Everything else is kept from the parent commit. */
  changes: Record<string, Change>;
  message: string; author: string; branch?: string; at?: number;
  /** The author's email; `<author>@` GIT_EMAIL_DOMAIN without it. */
  email?: string;
  /** Reads the parent's trees. Without it, `changes` is the whole tree. */
  base?: TreeReader;
  /** Make `ref`, a new ref, a commit on `parent` instead of moving `branch` (a beam, beam.ts). */
  to?: { ref: string; parent: string };
  /** More commits after this one, each on the one before, all in the one pack; the ref moves once, to the last (a stacked beam). */
  then?: { changes: Record<string, Change>; message: string }[];
}

/** The hash git uses for "no ref": the old side of a make, the new side of a delete. */
export const ZERO = "0".repeat(40);

/** A tree object's entries, read back from its body: how a commit in the pack reads the one before it, which the remote doesn't have yet. */
function entriesOf(body: Uint8Array) {
  const out: { name: string; mode: string; hash: string; type: string }[] = [], dec = new TextDecoder();
  for (let o = 0; o < body.length;) {
    const sp = body.indexOf(0x20, o), nul = body.indexOf(0, sp);
    const mode = dec.decode(body.subarray(o, sp));
    out.push({ mode, name: dec.decode(body.subarray(sp + 1, nul)), hash: hex(body.subarray(nul + 1, nul + 21)), type: mode === "40000" ? "tree" : mode === "160000" ? "commit" : "blob" });
    o = nul + 21;
  }
  return out;
}

/**
 * Push a commit on `branch` that applies `changes` to whatever the branch
 * points at now (and `then`'s commits on top of it). If someone moves it in
 * between, rebuild on theirs and retry. `commits` is every commit made, the first first.
 */
export async function push(remote: string, token: string, snap: Snapshot, tries = 3): Promise<{ commit: string; commits: string[]; parent: string | null; bytes: number }> {
  const ref = snap.to?.ref ?? `refs/heads/${snap.branch ?? "main"}`;
  // Artifacts tokens carry their expiry after a "?"; the secret is before it.
  const auth = { authorization: `Bearer ${token.split("?")[0]}` };
  for (let attempt = 1; ; attempt++) {
    const adv = await fetch(`${remote}/info/refs?service=git-receive-pack`, { headers: auth });
    if (!adv.ok) throw new Error(`git: ${adv.status} reading refs from ${remote}`);
    const refs = lines(new Uint8Array(await adv.arrayBuffer()));
    const old = refs.map((l) => l.split("\0")[0]!.split(" ")).find(([, r]) => r === ref)?.[0] ?? ZERO;
    if (snap.to && old !== ZERO) throw new Error(`git: ${ref} already exists on ${remote}`);
    const parent = snap.to?.parent ?? old;

    const objs: Obj[] = [];
    // The trees made so far are read from here: a commit after the first is built on the one before it.
    const made = new Map<string, Obj>();
    const reader: TreeReader = {
      readCommit: async (h) => (await snap.base?.readCommit(h)) ?? null,
      readTree: async (h) => { const o = made.get(h); return o ? entriesOf(o.body) : (await snap.base?.readTree(h)) ?? null; },
    };
    let tree: string | null = parent !== ZERO && snap.base ? (await snap.base.readCommit(parent))?.treeHash ?? null : null;
    const when = `${Math.floor((snap.at ?? Date.now()) / 1000)} +0000`;
    const who = `${snap.author} <${snap.email ?? `${snap.author}@${GIT_EMAIL_DOMAIN}`}> ${when}`;
    const commits: string[] = [];
    let under = parent;
    for (const c of [{ changes: snap.changes, message: snap.message }, ...snap.then ?? []]) {
      const out: Obj[] = [];
      const t = (await apply(reader, tree, c.changes, out)) ?? (out.push(await obj("tree", new Uint8Array())), out.at(-1)!);
      for (const o of out) if (o.type === "tree") made.set(o.id, o);
      const commit = await obj("commit", enc.encode(
        `tree ${t.id}\n${under !== ZERO ? `parent ${under}\n` : ""}author ${who}\ncommitter ${who}\n\n${c.message}\n`));
      objs.push(...out, commit);
      commits.push(commit.id);
      tree = t.id; under = commit.id;
    }

    // A file the same in two commits is one object in the pack.
    const seen = new Set<string>();
    const packed = await pack(objs.filter((o) => !seen.has(o.id) && !!seen.add(o.id)));
    const report = await receive(remote, auth, `${old} ${under} ${ref}`, packed);
    if (report.includes(`ok ${ref}`)) return { commit: under, commits, parent: parent === ZERO ? null : parent, bytes: packed.length };
    // Someone else pushed between our read and our write: rebuild on top of theirs.
    if (!snap.to && attempt < tries && report.some((l) => l.startsWith(`ng ${ref}`))) continue;
    throw new Error(`git: push rejected: ${report.join(" | ")}`);
  }
}

/** One file of a whole tree: its path, git mode (100644, 100755 or 120000 for a symlink) and bytes; or a submodule's commit (mode 160000). */
export type TreeFile = { path: string; mode: string; data: Uint8Array } | { path: string; mode: "160000"; commit: string }

interface Dir { files: Map<string, { mode: string; id: string }>; dirs: Map<string, Dir> }
const newDir = (): Dir => ({ files: new Map(), dirs: new Map() });

/**
 * Push `files` as the one, root commit of an empty repo: a big tree that
 * Artifacts won't import (see tarball.ts). Each object is deflated as it's
 * read and only the compressed bytes are kept, so the most this holds is
 * about one pack. Once a pack passes `packBytes`, it goes out on its own: a
 * commit of the files so far, on the branch itself, each building on the last
 * (#347). The branch then moves to one root commit of the whole tree, whose
 * objects the remote mostly has by then, and the parts fall away. Not a side
 * branch: an Artifact's HEAD is the first branch pushed to it, and forks keep
 * it, so HEAD would name a branch that's gone and a clone checks nothing out (#355).
 */
export async function pushTree(remote: string, token: string, files: AsyncIterable<TreeFile>, c: { message: string; author: string; email?: string; branch?: string; at?: number; packBytes?: number }): Promise<{ commit: string; objects: number; bytes: number; packs: number }> {
  const { createHash } = await import("node:crypto");
  const ref = `refs/heads/${c.branch ?? "main"}`, auth = { authorization: `Bearer ${token.split("?")[0]}` };
  const refs = async () => {
    const adv = await fetch(`${remote}/info/refs?service=git-receive-pack`, { headers: auth });
    if (!adv.ok) throw new Error(`git: ${adv.status} reading refs from ${remote}`);
    return new Map(lines(new Uint8Array(await adv.arrayBuffer())).map((l) => l.split("\0")[0]!.split(" ")).map(([id, r]) => [r!, id!]));
  };
  if ((await refs()).has(ref)) throw new Error(`git: ${ref} already exists on ${remote}`);

  // The pack so far, copied into 1 MB slabs: thousands of small arrays cost more than their bytes.
  let packed: Uint8Array[] = [], slab = new Uint8Array(2 ** 20), used = 0, inPack = 0, packBytes = 0;
  const seen = new Set<string>();
  let bytes = 0, objects = 0, packs = 0;
  const keep = (b: Uint8Array) => {
    for (let o = 0; o < b.length;) {
      if (used === slab.length) { packed.push(slab); slab = new Uint8Array(2 ** 20); used = 0; }
      const n = Math.min(b.length - o, slab.length - used);
      slab.set(b.subarray(o, o + n), used);
      used += n; o += n;
    }
    packBytes += b.length;
  };
  const add = async (type: Obj["type"], body: Uint8Array) => {
    const id = createHash("sha1").update(`${type} ${body.length}\0`).update(body).digest("hex");
    if (seen.has(id)) return id;
    seen.add(id);
    let n = body.length;
    const head = [(TYPES[type] << 4) | (n & 15)];
    n >>= 4;
    while (n > 0) { head[head.length - 1]! |= 0x80; head.push(n & 0x7f); n >>= 7; }
    keep(new Uint8Array(head));
    keep(await deflate(body));
    inPack++;
    return id;
  };

  /** Send the pack so far as `r` moving from `old` to `to`, and start the next. */
  const send = async (r: string, old: string, to: string) => {
    // The pack's trailer is the SHA-1 of everything before it, hashed as it goes out.
    packed.push(slab.subarray(0, used));
    const sum = createHash("sha1");
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, inPack);
    const chunks = [concat([enc.encode("PACK"), new Uint8Array([0, 0, 0, 2]), count]), ...packed];
    objects += inPack; bytes += packBytes; packs++;
    packed = []; slab = new Uint8Array(2 ** 20); used = 0; inPack = 0; packBytes = 0;
    const command = concat([pkt(`${old} ${to} ${r}\0report-status\n`), enc.encode("0000")]);
    const body = new ReadableStream<Uint8Array>({
      start(ctl) { ctl.enqueue(command); },
      pull(ctl) {
        const next = chunks.shift();
        if (next) { sum.update(next); ctl.enqueue(next); return; }
        ctl.enqueue(new Uint8Array(sum.digest()));
        ctl.close();
      },
    });
    const res = await fetch(`${remote}/git-receive-pack`, {
      method: "POST", body, duplex: "half",
      headers: { ...auth, "content-type": "application/x-git-receive-pack-request", accept: "application/x-git-receive-pack-result" },
    } as RequestInit);
    if (!res.ok) throw new Error(`git: ${res.status} pushing to ${remote}`);
    const report = lines(new Uint8Array(await res.arrayBuffer()));
    if (!report.includes(`ok ${r}`)) throw new Error(`git: push rejected: ${report.join(" | ")}`);
  };

  const root = newDir();
  const tree = async (d: Dir): Promise<string> => {
    const entries: { name: string; mode: string; id: string; dir: boolean }[] = [...d.files].map(([name, f]) => ({ name, ...f, dir: false }));
    for (const [name, sub] of d.dirs) entries.push({ name, mode: "40000", id: await tree(sub), dir: true });
    const key = (e: { name: string; dir: boolean }) => e.name + (e.dir ? "/" : "");
    entries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return add("tree", concat(entries.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), unhex(e.id)])));
  };
  const when = `${Math.floor((c.at ?? Date.now()) / 1000)} +0000`, who = `${c.author} <${c.email ?? `${c.author}@${GIT_EMAIL_DOMAIN}`}> ${when}`;
  const commit = async (message: string, parent?: string) =>
    add("commit", enc.encode(`tree ${await tree(root)}\n${parent ? `parent ${parent}\n` : ""}author ${who}\ncommitter ${who}\n\n${message}\n`));

  let part = ZERO;
  for await (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let d = root;
    for (const p of parts.slice(0, -1)) { let next = d.dirs.get(p); if (!next) d.dirs.set(p, next = newDir()); d = next; }
    d.files.set(parts.at(-1)!, { mode: f.mode, id: "commit" in f ? f.commit : await add("blob", f.data) });
    if (c.packBytes && packBytes > c.packBytes) {
      const to = await commit(`part ${packs + 1}`, part === ZERO ? undefined : part);
      await send(ref, part, to);
      part = to;
    }
  }
  const tip = await commit(c.message);
  await send(ref, part, tip);
  return { commit: tip, objects, bytes, packs };
}

/** One receive-pack request: a ref update ("old new ref") and the pack it needs; the report-status lines. */
async function receive(remote: string, auth: Record<string, string>, command: string, packed: Uint8Array) {
  const res = await fetch(`${remote}/git-receive-pack`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/x-git-receive-pack-request", accept: "application/x-git-receive-pack-result" },
    body: concat([pkt(`${command}\0report-status\n`), enc.encode("0000"), packed]),
  });
  if (!res.ok) throw new Error(`git: ${res.status} pushing to ${remote}`);
  return lines(new Uint8Array(await res.arrayBuffer()));
}

/**
 * A remote's refs, as its git advertises them: {ref: hash}. Peeled, an annotated
 * tag is the commit it points at (git's `^{}` line), so every tag names a commit;
 * unpeeled, it's the tag object, which is what a push to that ref checks against.
 */
export async function remoteRefs(remote: string, token: string, peel = true): Promise<Map<string, string>> {
  const res = await fetch(`${remote}/info/refs?service=git-upload-pack`, { headers: { authorization: `Bearer ${token.split("?")[0]}` } });
  if (!res.ok) throw new Error(`git: ${res.status} reading refs from ${remote}`);
  const out = new Map<string, string>();
  for (const l of lines(new Uint8Array(await res.arrayBuffer()))) {
    const [hash, ref] = l.split("\0")[0]!.split(" ");
    if (!hash || !/^[0-9a-f]{40,64}$/.test(hash) || !ref) continue;
    if (ref.endsWith("^{}")) { if (peel) out.set(ref.slice(0, -3), hash); }
    else if (!out.has(ref)) out.set(ref, hash);
  }
  return out;
}

/**
 * Point `ref` at `to` (an object the remote already has), if it's at `from` now:
 * ZERO for `from` makes it, ZERO for `to` deletes it. No objects go with it, so
 * a make sends an empty pack and a delete none, as git does. Null when it went,
 * else the remote's reason.
 */
export async function setRef(remote: string, token: string, ref: string, from: string, to: string): Promise<string | null> {
  const report = await receive(remote, { authorization: `Bearer ${token.split("?")[0]}` }, `${from} ${to} ${ref}`, to === ZERO ? new Uint8Array() : await pack([]));
  if (report.includes(`ok ${ref}`)) return null;
  return report.find((l) => l.startsWith(`ng ${ref}`))?.slice(`ng ${ref} `.length) || report.join(" | ") || "the remote didn't say";
}

/** A raw object as another repo holds it:a blob's bytes, or a tree's entries (built back to the same hash). */
export type Raw = { type: "blob"; body: Uint8Array } | { type: "tree"; entries: { name: string; mode: string; hash: string; type: string }[] };

export async function rawObj(r: Raw): Promise<Obj> {
  if (r.type === "blob") return obj("blob", r.body);
  const dir = (e: { type: string }) => e.type === "tree";
  const key = (e: { name: string; type: string }) => e.name + (dir(e) ? "/" : "");
  const sorted = [...r.entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return obj("tree", concat(sorted.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), unhex(e.hash)])));
}

/**
 * Copy objects into a repo a batch at a time, without a tree to hang them on
 * yet: each batch is a commit on `stage.branch` whose tree names every object
 * in it by its hash, on top of the last batch, so all of them stay reachable.
 * With `finish` ({tree, message}), the batch instead moves the branch to the
 * real commit, a root commit of that tree, and the staging commits fall away.
 * Staging on the branch itself matters on Cloudflare: an Artifact's HEAD is the
 * first branch pushed to it, so a staging branch of its own would leave HEAD
 * on a ref that's gone.
 */
export async function copyObjects(remote: string, token: string, objs: Obj[], stage: { branch: string; parent: string | null; author: string },
  finish?: { tree: string; message: string }): Promise<{ stage: string; commit?: string; bytes: number }> {
  const auth = { authorization: `Bearer ${token.split("?")[0]}` };
  const who = `${stage.author} <${stage.author}@${GIT_EMAIL_DOMAIN}> ${Math.floor(Date.now() / 1000)} +0000`;
  const ref = `refs/heads/${stage.branch}`;
  let commit: Obj, all: Obj[];
  if (finish) {
    commit = await obj("commit", enc.encode(`tree ${finish.tree}\nauthor ${who}\ncommitter ${who}\n\n${finish.message}\n`));
    all = [...objs, commit];
  } else {
    const holder = await rawObj({ type: "tree", entries: objs.map((o) => ({ name: o.id, mode: o.type === "tree" ? "40000" : "100644", hash: o.id, type: o.type })) });
    commit = await obj("commit", enc.encode(`tree ${holder.id}\n${stage.parent ? `parent ${stage.parent}\n` : ""}author ${who}\ncommitter ${who}\n\nfresh start: copying\n`));
    all = [...objs, holder, commit];
  }
  const packed = await pack(all);
  const report = await receive(remote, auth, `${stage.parent ?? ZERO} ${commit.id} ${ref}`, packed);
  if (!report.includes(`ok ${ref}`)) throw new Error(`git: push rejected: ${report.join(" | ")}`);
  return { stage: commit.id, commit: finish ? commit.id : undefined, bytes: packed.length };
}
