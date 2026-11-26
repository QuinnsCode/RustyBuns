// PageFS: PGlite's data dir kept as 8 KB pages in a Durable Object's SQLite, so a write costs what it changes
// (#5866 step 2) instead of re-saving the whole 4.8 MB dump. Postgres writes in 8 KB blocks, so one page row
// is one Postgres block. A page that is all zeros has no row (the 16 MB WAL segment starts as zeros), and a
// missing page reads as zeros up to the file's size.
//
// Pages and sizes are held in memory as they change and written out in one `transactionSync` by `syncToFs`,
// which PGlite calls after every query, before the reply goes out. Creating, renaming and removing files
// write through at once. Clean pages are kept up to `maxCleanPages`; Postgres's own buffers sit in WASM memory.
import { BaseFilesystem, ERRNO_CODES, type FsStats } from "@electric-sql/pglite/basefs";

export const PAGE = 8192;
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

// What DO SQLite hands back (bun:sqlite gives a Uint8Array for a BLOB, which reads the same here).
type Value = ArrayBuffer | string | number | null;
// Pages go in as Uint8Array, which DO SQLite and bun:sqlite both take as a BLOB.
type Binding = Uint8Array | string | number | null;
/** What PageFS needs of a Durable Object's `ctx.storage` (which fits as is) or any synchronous SQLite. */
export interface PageStore {
  sql: { exec<T extends Record<string, Value>>(query: string, ...bindings: Binding[]): { toArray(): T[] } };
  transactionSync<T>(fn: () => T): T;
}

interface Node { mode: number; size: number; mtime: number }
type NodeRow = { path: string; mode: number; size: number; mtime: number };
type PageRow = { data: ArrayBuffer };

class FsError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
const fail = (code: keyof typeof ERRNO_CODES, path: string): never => { throw new FsError(ERRNO_CODES[code], `${code}: ${path}`); };
const isDir = (n: Node) => (n.mode & S_IFMT) === S_IFDIR;
const norm = (p: string) => (p === "" ? "/" : p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
const parentOf = (p: string) => (p.lastIndexOf("/") <= 0 ? "/" : p.slice(0, p.lastIndexOf("/")));
const key = (path: string, n: number) => `${n}\0${path}`;
const allZero = (b: Uint8Array) => { for (let i = 0; i < b.length; i++) if (b[i]) return false; return true; };

export interface PageStats { pagesRead: number; pagesWritten: number; pagesDropped: number }

export class PageFS extends BaseFilesystem {
  readonly stats: PageStats = { pagesRead: 0, pagesWritten: 0, pagesDropped: 0 };
  private nodes = new Map<string, Node>();
  private pages = new Map<string, Uint8Array>();
  private dirty = new Map<string, { path: string; n: number }>();
  private dirtyNodes = new Set<string>();
  private fds = new Map<number, string>();
  private nextFd = 1;

  constructor(private store: PageStore, private opts: { maxCleanPages?: number; maxDirtyPages?: number } = {}) {
    super();
    const { sql } = store;
    sql.exec("CREATE TABLE IF NOT EXISTS pg_nodes (path TEXT PRIMARY KEY, mode INTEGER NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS pg_pages (path TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (path, n))");
    for (const r of sql.exec<NodeRow>("SELECT path, mode, size, mtime FROM pg_nodes").toArray()) this.nodes.set(r.path, { mode: r.mode, size: r.size, mtime: r.mtime });
    if (!this.nodes.has("/")) this.put("/", { mode: S_IFDIR | 0o777, size: 0, mtime: Date.now() });
  }

  /** No data dir saved yet: boot from a template's tarball (PGlite refuses `loadDataDir` over an existing one). */
  get empty(): boolean { return !this.nodes.has("/PG_VERSION"); }

  /** Stored bytes, as rows hold them (zero pages take none). */
  storedBytes(): number {
    return this.store.sql.exec<{ b: number }>("SELECT COALESCE(SUM(LENGTH(data)), 0) AS b FROM pg_pages").toArray()[0]?.b ?? 0;
  }

  override async syncToFs() { this.flush(); }
  override async closeFs() { this.flush(); }

  /** Write every changed page and size in one transaction. */
  flush() {
    if (!this.dirty.size && !this.dirtyNodes.size) return;
    const { sql } = this.store;
    this.store.transactionSync(() => {
      for (const [k, { path, n }] of this.dirty) {
        const page = this.pages.get(k);
        if (!page || allZero(page)) {
          sql.exec("DELETE FROM pg_pages WHERE path = ? AND n = ?", path, n);
          this.pages.delete(k);
        } else {
          sql.exec("INSERT OR REPLACE INTO pg_pages (path, n, data) VALUES (?, ?, ?)", path, n, page);
          this.stats.pagesWritten++;
        }
      }
      for (const path of this.dirtyNodes) {
        const node = this.nodes.get(path);
        if (node) sql.exec("UPDATE pg_nodes SET mode = ?, size = ?, mtime = ? WHERE path = ?", node.mode, node.size, node.mtime, path);
      }
    });
    this.dirty.clear();
    this.dirtyNodes.clear();
    this.trim();
  }

  // The filesystem PGlite's Emscripten mount calls into.

  chmod(path: string, mode: number) {
    const node = this.get(path);
    node.mode = (node.mode & S_IFMT) | (mode & 0o7777);
    this.dirtyNodes.add(norm(path));
  }

  close(fd: number) { this.fds.delete(fd); }

  fstat(fd: number): FsStats { return this.lstat(this.fdPath(fd)); }

  lstat(path: string): FsStats {
    const n = this.get(path);
    return { dev: 0, ino: 0, mode: n.mode, nlink: 1, uid: 0, gid: 0, rdev: 0, size: n.size, blksize: PAGE, blocks: Math.ceil(n.size / PAGE), atime: n.mtime, mtime: n.mtime, ctime: n.mtime };
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }) {
    const p = norm(path);
    if (this.nodes.has(p)) { if (options?.recursive) return; fail("EEXIST", p); }
    const up = parentOf(p);
    if (!this.nodes.has(up)) { if (options?.recursive) this.mkdir(up, options); else fail("ENOENT", up); }
    this.put(p, { mode: S_IFDIR | ((options?.mode ?? 0o777) & 0o7777), size: 0, mtime: Date.now() });
  }

  open(path: string): number {
    const p = norm(path);
    if (isDir(this.get(p))) fail("EISDIR", p);
    const fd = this.nextFd++;
    this.fds.set(fd, p);
    return fd;
  }

  readdir(path: string): string[] {
    const p = norm(path);
    if (!isDir(this.get(p))) fail("ENOTDIR", p);
    const prefix = p === "/" ? "/" : `${p}/`;
    const out: string[] = [];
    for (const k of this.nodes.keys()) if (k !== p && k.startsWith(prefix) && !k.includes("/", prefix.length)) out.push(k.slice(prefix.length));
    return out;
  }

  read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const path = this.fdPath(fd);
    const end = Math.min(position + length, this.get(path).size);
    const out = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, Math.max(0, end - position));
    for (let at = position; at < end;) {
      const n = Math.floor(at / PAGE), from = at - n * PAGE, take = Math.min(PAGE - from, end - at);
      const page = this.page(path, n, false);
      if (page) out.set(page.subarray(from, from + take), at - position);
      else out.fill(0, at - position, at - position + take);
      at += take;
    }
    return out.length;
  }

  rename(oldPath: string, newPath: string) {
    const from = norm(oldPath), to = norm(newPath);
    if (from === to) return;
    this.get(from);
    if (this.nodes.has(to)) { if (isDir(this.get(to))) this.rmdir(to); else this.unlink(to); }
    const moving = [...this.nodes.keys()].filter((k) => k === from || k.startsWith(`${from}/`));
    const { sql } = this.store;
    this.store.transactionSync(() => {
      for (const k of moving) {
        const dest = to + k.slice(from.length);
        sql.exec("UPDATE pg_nodes SET path = ? WHERE path = ?", dest, k);
        sql.exec("UPDATE pg_pages SET path = ? WHERE path = ?", dest, k);
        this.nodes.set(dest, this.nodes.get(k)!);
        this.nodes.delete(k);
        if (this.dirtyNodes.delete(k)) this.dirtyNodes.add(dest);
        this.movePages(k, dest);
        for (const [fd, p] of this.fds) if (p === k) this.fds.set(fd, dest);
      }
    });
  }

  rmdir(path: string) {
    const p = norm(path);
    if (p === "/") fail("EINVAL", p);
    if (!isDir(this.get(p))) fail("ENOTDIR", p);
    if (this.readdir(p).length) fail("ENOTEMPTY", p);
    this.drop(p);
  }

  truncate(path: string, len: number) {
    const p = norm(path), node = this.get(p);
    if (isDir(node)) fail("EISDIR", p);
    if (len < node.size) {
      const keep = Math.ceil(len / PAGE);
      for (const k of [...this.pages.keys()]) if (k.endsWith(`\0${p}`) && Number(k.slice(0, k.indexOf("\0"))) >= keep) { this.pages.delete(k); this.dirty.delete(k); }
      this.store.sql.exec("DELETE FROM pg_pages WHERE path = ? AND n >= ?", p, keep);
      this.stats.pagesDropped++;
      const tail = len % PAGE;
      if (tail) { const last = this.page(p, keep - 1, true)!; last.fill(0, tail); this.mark(p, keep - 1); }
    }
    node.size = len;
    node.mtime = Date.now();
    this.dirtyNodes.add(p);
  }

  unlink(path: string) {
    const p = norm(path);
    if (isDir(this.get(p))) fail("EISDIR", p);
    this.drop(p);
  }

  utimes(path: string, _atime: number, mtime: number) {
    this.get(path).mtime = mtime;
    this.dirtyNodes.add(norm(path));
  }

  writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }) {
    const p = norm(path);
    if (!this.nodes.has(parentOf(p))) fail("ENOENT", parentOf(p));
    if (this.nodes.has(p)) this.truncate(p, 0);
    else this.put(p, { mode: S_IFREG | ((options?.mode ?? 0o666) & 0o7777), size: 0, mtime: Date.now() });
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.length) { const fd = this.open(p); this.write(fd, bytes, 0, bytes.length, 0); this.close(fd); }
  }

  write(fd: number, buffer: Uint8Array | ArrayBuffer, offset: number, length: number, position: number): number {
    // PGlite's mount hands over the heap's ArrayBuffer here, not a view.
    const src = buffer instanceof Uint8Array ? buffer.subarray(offset, offset + length) : new Uint8Array(buffer, offset, length);
    const path = this.fdPath(fd), node = this.get(path);
    for (let at = position; at < position + length;) {
      const n = Math.floor(at / PAGE), from = at - n * PAGE, take = Math.min(PAGE - from, position + length - at);
      const page = this.page(path, n, true)!;
      page.set(src.subarray(at - position, at - position + take), from);
      this.mark(path, n);
      at += take;
    }
    if (position + length > node.size) node.size = position + length;
    node.mtime = Date.now();
    this.dirtyNodes.add(path);
    if (this.dirty.size > (this.opts.maxDirtyPages ?? 4096)) this.flush();
    return length;
  }

  // Inside.

  private get(path: string): Node { return this.nodes.get(norm(path)) ?? fail("ENOENT", path); }

  private fdPath(fd: number): string { return this.fds.get(fd) ?? fail("EBADF", String(fd)); }

  private put(path: string, node: Node) {
    this.nodes.set(path, node);
    this.store.sql.exec("INSERT OR REPLACE INTO pg_nodes (path, mode, size, mtime) VALUES (?, ?, ?, ?)", path, node.mode, node.size, node.mtime);
  }

  private drop(path: string) {
    this.nodes.delete(path);
    this.dirtyNodes.delete(path);
    this.movePages(path, null);
    this.store.sql.exec("DELETE FROM pg_nodes WHERE path = ?", path);
    this.store.sql.exec("DELETE FROM pg_pages WHERE path = ?", path);
  }

  /** Move (or with `to` null, forget) a file's cached and dirty pages. */
  private movePages(from: string, to: string | null) {
    const tail = `\0${from}`;
    for (const [k, page] of [...this.pages]) {
      if (!k.endsWith(tail)) continue;
      const n = Number(k.slice(0, k.indexOf("\0")));
      this.pages.delete(k);
      const wasDirty = this.dirty.delete(k);
      if (to === null) continue;
      this.pages.set(key(to, n), page);
      if (wasDirty) this.dirty.set(key(to, n), { path: to, n });
    }
  }

  private page(path: string, n: number, create: boolean): Uint8Array | undefined {
    const k = key(path, n);
    let page = this.pages.get(k);
    if (page) return page;
    const row = this.store.sql.exec<PageRow>("SELECT data FROM pg_pages WHERE path = ? AND n = ?", path, n).toArray()[0];
    if (row) { this.stats.pagesRead++; page = new Uint8Array(PAGE); page.set(new Uint8Array(row.data)); }
    else if (create) page = new Uint8Array(PAGE);
    else return undefined;
    this.pages.set(k, page);
    this.trim();
    return page;
  }

  private mark(path: string, n: number) { this.dirty.set(key(path, n), { path, n }); }

  /** Forget the oldest clean pages past the cap; dirty ones wait for the next flush. */
  private trim() {
    let over = this.pages.size - this.dirty.size - (this.opts.maxCleanPages ?? 1024);
    for (const k of this.pages.keys()) {
      if (over <= 0) break;
      if (this.dirty.has(k)) continue;
      this.pages.delete(k);
      over--;
    }
  }
}
