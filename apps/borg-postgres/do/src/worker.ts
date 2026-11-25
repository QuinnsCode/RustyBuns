// Spike: PGlite (Postgres in WASM) in a SQLite-backed Durable Object, one DO per preview database.
// Persistence here is the simple kind: the whole data dir as a gzip tarball in 1.5 MB rows.
// workerd can't run initdb (Emscripten's addFunction compiles WASM at runtime, which workerd blocks),
// so a new database starts as a copy of the `__template` DO: an empty cluster made once by initdb in
// Bun (make-template.ts) and POSTed to /seed. A branch is the same copy, from any other database.
import "./shim.ts";
import { DurableObject } from "cloudflare:workers";
import { PGlite } from "@electric-sql/pglite";
import pgliteWasmModule from "./pglite.wasm";
import pgliteData from "./pglite.data";

interface Env { PG: DurableObjectNamespace<Pg> }
const CHUNK = 1_500_000;
const TEMPLATE = "__template";
// workerd's clocks only move across I/O, so CPU-only spans read 0 in production; locally they're real.
const now = () => performance.now();
const ms = (t: number) => Math.round(now() - t);

export class Pg extends DurableObject<Env> {
  db?: PGlite;
  boot: Record<string, number> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS dump (i INTEGER PRIMARY KEY, b BLOB)");
  }

  stored(): Uint8Array | undefined {
    const rows = [...this.ctx.storage.sql.exec<{ b: ArrayBuffer }>("SELECT b FROM dump ORDER BY i")];
    if (!rows.length) return undefined;
    const out = new Uint8Array(rows.reduce((n, r) => n + r.b.byteLength, 0));
    let at = 0;
    for (const r of rows) { out.set(new Uint8Array(r.b), at); at += r.b.byteLength; }
    return out;
  }

  write(buf: Uint8Array) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM dump");
      for (let i = 0; i * CHUNK < buf.length; i++) this.ctx.storage.sql.exec("INSERT INTO dump VALUES (?, ?)", i, buf.slice(i * CHUNK, (i + 1) * CHUNK));
    });
  }

  /** Boot PGlite from this DO's saved dump, else from a copy of `parent` (the template by default). */
  async open(parent = TEMPLATE): Promise<PGlite> {
    if (this.db) return this.db;
    const t = now();
    let dump = this.stored();
    let copyMs = 0;
    if (!dump) {
      if (this.ctx.id.name === TEMPLATE) throw new Error("no template yet: POST make-template.ts's file to /seed");
      dump = await this.env.PG.getByName(parent).dump();
      if (!dump.byteLength) throw new Error(`${parent} has no saved state`);
      copyMs = ms(t);
      this.write(dump);
    }
    const t2 = now();
    this.db = await PGlite.create({
      pgliteWasmModule, fsBundle: new Blob([pgliteData]),
      loadDataDir: new Blob([dump], { type: "application/x-gzip" }),
    });
    this.boot = { copyMs, bootMs: ms(t2), openMs: ms(t), dumpBytes: dump.byteLength };
    return this.db;
  }

  async save(): Promise<{ saveMs: number; bytes: number }> {
    const t = now();
    const buf = new Uint8Array(await (await this.db!.dumpDataDir("gzip")).arrayBuffer());
    this.write(buf);
    return { saveMs: ms(t), bytes: buf.byteLength };
  }

  async query(sql: string, write = false) {
    const fresh = !this.db;
    await this.open();
    const t = now();
    const res = await this.db!.exec(sql);
    const queryMs = ms(t);
    const saved = write ? await this.save() : undefined;
    return { fresh, ...(fresh ? this.boot : {}), queryMs, ...saved, rows: res.at(-1)?.rows ?? [] };
  }

  async dump(): Promise<Uint8Array> {
    return this.stored() ?? new Uint8Array();
  }

  seed(buf: Uint8Array) { this.write(buf); return { seededBytes: buf.byteLength }; }

  /** A branch: this database starts as a copy of `parent`'s last saved state. */
  async branchFrom(parent: string) {
    if (this.db || this.stored()) throw new Error(`${this.ctx.id.name} exists already`);
    await this.open(parent);
    return { ...this.boot };
  }

  /** Throw the instance away, as an eviction or deploy would: the next call boots from storage. */
  restart() { this.ctx.abort("restart"); }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    const name = u.searchParams.get("name") ?? "main";
    const stub = env.PG.getByName(name);
    const t = now();
    let out: object;
    try {
      switch (u.pathname) {
        case "/seed": out = await env.PG.getByName(TEMPLATE).seed(new Uint8Array(await req.arrayBuffer())); break;
        case "/q": out = await stub.query(u.searchParams.get("sql") ?? "select 1 as one", u.searchParams.has("write")); break;
        case "/branch": out = await stub.branchFrom(u.searchParams.get("from") ?? "main"); break;
        case "/restart": try { await stub.restart(); } catch { /* the abort comes back as an error */ } out = { restarted: name }; break;
        default: return new Response("try /seed, /q?name=a&sql=..., /branch?name=b&from=a, /restart?name=a", { status: 404 });
      }
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
    return Response.json({ wallMs: ms(t), ...out });
  },
};
