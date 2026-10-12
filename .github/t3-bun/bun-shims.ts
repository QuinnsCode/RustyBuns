// Preload for running T3 Code's Node server under Bun without touching their tree:
// each Node built-in Bun lacks gets the smallest stand-in, listed here as we find them.
// Pass it to vitest's workers too with BUN_OPTIONS="--preload <this file>".
import { plugin } from "bun";
import { Readable } from "node:stream";

plugin({
  name: "t3-node-shims",
  setup(b) {
    // node:sea (single executable apps): T3 only asks isSea(); under Bun it never is.
    b.module("node:sea", () => ({ exports: { isSea: () => false, getAsset: () => { throw new Error("not a SEA"); } }, loader: "object" }));
  },
});

// net.Socket({ fd }) on an inherited pipe never emits data under Bun 1.4 (the
// desktop's browser and telemetry channels). fs.createReadStream reads it but, like
// Node's, keeps the process alive after destroy() while a read is pending; a web
// stream over Bun.file(fd) reads it and cancels cleanly.
const net = require("node:net");
const BunSocket = net.Socket;
// A subclass, not a wrapper function: Bun's own HTTP server extends net.Socket, and a
// wrapper that returns a fresh BunSocket would drop that subclass's methods.
class Socket extends BunSocket {
  constructor(options?: { fd?: number; readable?: boolean; writable?: boolean }) {
    if (typeof options?.fd === "number" && options.readable !== false && options.writable === false) {
      return Readable.fromWeb(Bun.file(options.fd).stream() as never);
    }
    super(options);
  }
}
net.Socket = Socket;

// v8.queryObjects(Ctor, { format: "count" }): count live instances by class name in a JSC heap snapshot.
const v8 = require("node:v8");
v8.queryObjects ??= (ctor: { name: string }) => {
  Bun.gc(true);
  const snapshot = Bun.generateHeapSnapshot() as unknown as { nodes: number[]; nodeClassNames: string[] };
  const index = snapshot.nodeClassNames.indexOf(ctor.name);
  let count = 0;
  // Inspector snapshot nodes are [id, size, classNameIndex, flags].
  if (index >= 0) for (let i = 2; i < snapshot.nodes.length; i += 4) if (snapshot.nodes[i] === index) count++;
  return count;
};

// v8.setFlagsFromString("--expose-gc") then vm.runInNewContext("gc"): Node's way to reach gc at runtime.
const vm = require("node:vm");
const runInNewContext = vm.runInNewContext;
vm.runInNewContext = (code: unknown, ...rest: unknown[]) =>
  typeof code === "string" && code.trim() === "gc" ? () => Bun.gc(true) : runInNewContext(code, ...rest);

// node:sqlite DatabaseSync.close() under Bun 1.4 leaves the database file open while any
// statement it prepared is still alive (Node finalizes them on close). Effect's SQL client
// caches statements, so on Windows a test can't delete its temp folder (EBUSY). Hand out
// statements behind a holder that close() empties, then collect so Bun finalizes them.
const sqlite = require("node:sqlite");
const { prepare, close } = sqlite.DatabaseSync.prototype;
const holders = new WeakMap<object, Set<{ s?: object }>>();
const forget = new FinalizationRegistry<{ set: Set<{ s?: object }>; h: { s?: object } }>(({ set, h }) => set.delete(h));
sqlite.DatabaseSync.prototype.prepare = function (this: object, ...args: unknown[]) {
  const h: { s?: object } = { s: prepare.apply(this, args) };
  let set = holders.get(this);
  if (!set) holders.set(this, (set = new Set()));
  set.add(h);
  const proxy = new Proxy(Object.create(sqlite.StatementSync.prototype), {
    get(_t, prop) {
      if (!h.s) throw Object.assign(new Error("statement has been finalized"), { code: "ERR_INVALID_STATE" });
      const v = Reflect.get(h.s, prop, h.s);
      return typeof v === "function" ? v.bind(h.s) : v;
    },
  });
  forget.register(proxy, { set, h });
  return proxy;
};
sqlite.DatabaseSync.prototype.close = function (this: object) {
  for (const h of holders.get(this) ?? []) h.s = undefined;
  holders.delete(this);
  close.call(this);
  Bun.gc(true);
};
