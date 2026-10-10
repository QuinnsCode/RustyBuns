// Push changed files to a git remote over smart HTTP, with no git library:
// build the blobs, rebuild only the trees along changed paths (reading the
// rest from the parent), pack the new objects, and send one receive-pack
// request. Artifacts only takes writes as a git push, and this is
// all a push is. Runs the same in a Worker and under Bun (Web Crypto and
// CompressionStream only).

const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
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
interface Obj { type: keyof typeof TYPES; body: Uint8Array; id: string }

async function obj(type: Obj["type"], body: Uint8Array): Promise<Obj> {
  const id = hex(await sha1(concat([enc.encode(`${type} ${body.length}\0`), body])));
  return { type, body, id };
}

/** Reads an existing repo's commits and trees (the Artifacts repo handle has this shape). */
export interface TreeReader {
  readCommit(hash: string): Promise<{ treeHash: string } | null>;
  readTree(hash: string): Promise<{ name: string; mode: string; hash: string; type: string }[] | null>;
}
interface Entry { name: string; mode: string; id: string; dir: boolean }

/**
 * The tree at `treeHash` with `changes` applied ({ "a/b.ts": content, "old.ts": null }).
 * Only the trees along changed paths are rebuilt; everything else keeps its
 * hash and stays out of the pack (the remote already has it). Returns null for
 * an empty tree.
 */
async function apply(base: TreeReader | undefined, treeHash: string | null, changes: Record<string, string | null>, out: Obj[]): Promise<Obj | null> {
  const entries = new Map<string, Entry>();
  if (treeHash && base) for (const e of (await base.readTree(treeHash)) ?? []) entries.set(e.name, { name: e.name, mode: e.mode, id: e.hash, dir: e.type === "tree" });
  const here: Record<string, string | null> = {}, sub: Record<string, Record<string, string | null>> = {};
  for (const [path, content] of Object.entries(changes)) {
    const i = path.indexOf("/");
    if (i < 0) here[path] = content;
    else (sub[path.slice(0, i)] ??= {})[path.slice(i + 1)] = content;
  }
  for (const [name, content] of Object.entries(here)) {
    if (content === null) { entries.delete(name); continue; }
    const b = await obj("blob", enc.encode(content));
    out.push(b);
    const was = entries.get(name);
    entries.set(name, { name, mode: was && !was.dir ? was.mode : "100644", id: b.id, dir: false });
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
  changes: Record<string, string | null>;
  message: string; author: string; branch?: string; at?: number;
  /** Reads the parent's trees. Without it, `changes` is the whole tree. */
  base?: TreeReader;
}

const ZERO = "0".repeat(40);

/**
 * Push a commit on `branch` that applies `changes` to whatever the branch
 * points at now. If someone moves it in between, rebuild on theirs and retry.
 */
export async function push(remote: string, token: string, snap: Snapshot, tries = 3): Promise<{ commit: string; parent: string | null }> {
  const branch = snap.branch ?? "main", ref = `refs/heads/${branch}`;
  // Artifacts tokens carry their expiry after a "?"; the secret is before it.
  const auth = { authorization: `Bearer ${token.split("?")[0]}` };
  for (let attempt = 1; ; attempt++) {
    const adv = await fetch(`${remote}/info/refs?service=git-receive-pack`, { headers: auth });
    if (!adv.ok) throw new Error(`git: ${adv.status} reading refs from ${remote}`);
    const refs = lines(new Uint8Array(await adv.arrayBuffer()));
    const old = refs.map((l) => l.split("\0")[0]!.split(" ")).find(([, r]) => r === ref)?.[0] ?? ZERO;

    const objs: Obj[] = [];
    const parentTree = old !== ZERO && snap.base ? (await snap.base.readCommit(old))?.treeHash ?? null : null;
    const tree = (await apply(snap.base, parentTree, snap.changes, objs)) ?? (objs.push(await obj("tree", new Uint8Array())), objs.at(-1)!);
    const when = `${Math.floor((snap.at ?? Date.now()) / 1000)} +0000`;
    const who = `${snap.author} <${snap.author}@codesplitters.local> ${when}`;
    const commit = await obj("commit", enc.encode(
      `tree ${tree.id}\n${old !== ZERO ? `parent ${old}\n` : ""}author ${who}\ncommitter ${who}\n\n${snap.message}\n`));
    objs.push(commit);

    const res = await fetch(`${remote}/git-receive-pack`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/x-git-receive-pack-request", accept: "application/x-git-receive-pack-result" },
      body: concat([pkt(`${old} ${commit.id} ${ref}\0report-status\n`), enc.encode("0000"), await pack(objs)]),
    });
    if (!res.ok) throw new Error(`git: ${res.status} pushing to ${remote}`);
    const report = lines(new Uint8Array(await res.arrayBuffer()));
    if (report.includes(`ok ${ref}`)) return { commit: commit.id, parent: old === ZERO ? null : old };
    // Someone else pushed between our read and our write: rebuild on top of theirs.
    if (attempt < tries && report.some((l) => l.startsWith(`ng ${ref}`))) continue;
    throw new Error(`git: push rejected: ${report.join(" | ")}`);
  }
}

/** One file of a whole tree: its path, git mode (100644, 100755 or 120000 for a symlink) and bytes; or a submodule's commit (mode 160000). */
export type TreeFile = { path: string; mode: string; data: Uint8Array } | { path: string; mode: "160000"; commit: string }

interface Dir { files: Map<string, { mode: string; id: string }>; dirs: Map<string, Dir> }
const newDir = (): Dir => ({ files: new Map(), dirs: new Map() });

/** Where a big push parks its packs on the way (see pushTree), dropped once the branch is up. */
const PARTS = "refs/heads/codesplitters-parts";

/**
 * Push `files` as the one, root commit of an empty repo: a big tree that
 * Artifacts won't import (see tarball.ts). Each object is deflated as it's
 * read and only the compressed bytes are kept, so the most this holds is
 * about one pack. Once a pack passes `packBytes`, it goes out on its own: a
 * commit of the files so far, on a side branch, each building on the last
 * (#347). The branch then gets one root commit of the whole tree, whose
 * objects the remote mostly has by then, and the side branch goes.
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
  const when = `${Math.floor((c.at ?? Date.now()) / 1000)} +0000`, who = `${c.author} <${c.email ?? `${c.author}@codesplitters.local`}> ${when}`;
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
      await send(PARTS, part, to);
      part = to;
    }
  }
  const tip = await commit(c.message);
  await send(ref, ZERO, tip);
  // The side branch has done its job; a remote that won't drop it just keeps it.
  if (part !== ZERO) {
    const res = await fetch(`${remote}/git-receive-pack`, {
      method: "POST", body: concat([pkt(`${part} ${ZERO} ${PARTS}\0report-status delete-refs\n`), enc.encode("0000")]),
      headers: { ...auth, "content-type": "application/x-git-receive-pack-request", accept: "application/x-git-receive-pack-result" },
    }).catch(() => null);
    await res?.arrayBuffer().catch(() => null);
  }
  return { commit: tip, objects, bytes, packs };
}
