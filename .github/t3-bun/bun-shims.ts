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
    // Vitest's import.meta.resolve(id, parent) passes the test file's file:///C:/… URL as the
    // parent, and Bun on Windows can't resolve from a URL there (a path works). Hand it the path.
    b.onLoad({ filter: /[\\/]vitest[\\/]dist[\\/]chunks[\\/]index\.[\w-]+\.js$/ }, async ({ path }) => ({
      loader: "js",
      contents: (await Bun.file(path).text()).replace(
        "import.meta.resolve(specifier, importer)",
        'import.meta.resolve(specifier, importer.startsWith("file:") ? Bun.fileURLToPath(importer) : importer)',
      ),
    }));
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

// ws's WebSocketServer({ perMessageDeflate: true }) never compresses under Bun 1.4: its
// handleUpgrade goes through the Bun.serve that node:http starts, whose websocket options
// leave deflate off. Once a server asks for it, turn it on in those (live and later ones).
const serve = Bun.serve;
type NodeServeOptions = { onNodeHTTPRequest?: unknown; websocket?: object };
const nodeHttpServers = new Map<{ reload(o: object): unknown }, NodeServeOptions>();
let deflate = false;
const withDeflate = (o: NodeServeOptions) => ({ ...o, websocket: { ...o.websocket, perMessageDeflate: true } });
Bun.serve = ((options: NodeServeOptions) => {
  if (!options?.onNodeHTTPRequest || !options.websocket) return serve(options as never);
  const server = serve((deflate ? withDeflate(options) : options) as never);
  nodeHttpServers.set(server as never, options);
  return server;
}) as typeof Bun.serve;
const ws = require("ws");
const BunWebSocketServer = ws.WebSocketServer;
class WebSocketServer extends BunWebSocketServer {
  constructor(options?: { perMessageDeflate?: unknown }, callback?: () => void) {
    super(options, callback);
    if (!options?.perMessageDeflate || deflate) return;
    deflate = true;
    for (const [server, o] of nodeHttpServers) {
      try { server.reload(withDeflate(o)); } catch { nodeHttpServers.delete(server); }
    }
  }
}
ws.WebSocketServer = ws.Server = WebSocketServer;

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
