// Push a snapshot of files to a git remote over smart HTTP, with no git
// library: build the blob, tree and commit objects, pack them, and send one
// receive-pack request. Artifacts only takes writes as a git push, and this is
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

/** Blobs and nested trees for a flat { "a/b.ts": content } map. Returns the root tree last. */
async function trees(files: Record<string, string>, out: Obj[]): Promise<Obj> {
  const here: Record<string, string> = {}, sub: Record<string, Record<string, string>> = {};
  for (const [path, content] of Object.entries(files)) {
    const i = path.indexOf("/");
    if (i < 0) here[path] = content;
    else (sub[path.slice(0, i)] ??= {})[path.slice(i + 1)] = content;
  }
  const entries: { name: string; mode: string; id: string; dir: boolean }[] = [];
  for (const [name, content] of Object.entries(here)) {
    const b = await obj("blob", enc.encode(content));
    out.push(b);
    entries.push({ name, mode: "100644", id: b.id, dir: false });
  }
  for (const [name, inner] of Object.entries(sub)) {
    const t = await trees(inner, out);
    entries.push({ name, mode: "40000", id: t.id, dir: true });
  }
  // Git orders a tree as if each directory name ended in "/".
  const key = (e: (typeof entries)[number]) => e.name + (e.dir ? "/" : "");
  entries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const tree = await obj("tree", concat(entries.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), unhex(e.id)])));
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

export interface Snapshot { files: Record<string, string>; message: string; author: string; branch?: string; at?: number }

const ZERO = "0".repeat(40);

/**
 * Push `files` as the whole tree of a new commit on `branch`. The parent is
 * whatever the branch points at now; if someone moves it in between, retry.
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
    const tree = await trees(snap.files, objs);
    const when = `${Math.floor((snap.at ?? Date.now()) / 1000)} +0000`;
    const who = `${snap.author} <${snap.author}@gitcode.local> ${when}`;
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
