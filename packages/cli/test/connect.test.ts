// worker.connect (#5506): a Worker's inbound TCP `connect()` export through the config, wrangler.jsonc and
// `rustybuns dev`'s bridge. The dev Worker here is a Bun server standing in for workerd's WebSocket, running
// the dev entry and adapter rustybuns dev writes; everything from the TCP port to connect() is the real code.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { connect as dial } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { droppedWranglerKeys, parseWrangler, wranglerToConfig } from "../src/wrangler.ts";
import { generateWrangler } from "../src/gen/wrangler.ts";
import { bridgeConnect, connectUrl, writeConnectEntry } from "../src/connect-dev.ts";
import { CONNECT_PATH, type FrameSocket, type InboundSocket } from "../src/connect-worker.ts";
import { freePort } from "../src/containers.ts";

const dir = mkdtempSync(join(tmpdir(), "rb-connect-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a wrangler connect port comes in as worker.connect and goes back out to wrangler.jsonc", () => {
  const w = parseWrangler(`{ "name": "gate", "main": "worker.ts", "compatibility_date": "2026-06-01",
    "connect": [{ "protocol": "tcp", "port": 8788 }] }`);
  expect(droppedWranglerKeys(w)).toEqual([]);
  const c = wranglerToConfig(w);
  expect(c.worker?.connect).toEqual({ port: 8788 });
  expect(JSON.parse(generateWrangler(c).replace(/^\/\/.*$/gm, "")).connect).toEqual([{ protocol: "tcp", port: 8788 }]);
});

test("rustybuns dev: a TCP client talks to the Worker's connect(), half-close and all", async () => {
  // The app's built bundle: a Durable Object class, fetch, and a connect() that answers once the client is done
  // sending, the way git over ssh does (it closes its side after its packs, then reads the reply).
  mkdirSync(join(dir, "dist/worker"), { recursive: true });
  writeFileSync(join(dir, "dist/worker/worker.js"), `export class Gate {}
export default {
  fetch() { return new Response("http still here"); },
  async connect(socket) {
    const said = await new Response(socket.readable).text();
    const w = socket.writable.getWriter();
    await w.write(new TextEncoder().encode("you said " + said.toUpperCase()));
    await w.close();
  },
};
`);
  const entry = writeConnectEntry({ main: "src/worker.ts", builtMain: "dist/worker/worker.js", compatibilityDate: "2026-06-01", compatibilityFlags: [], connect: { port: 1 } }, dir);
  expect(entry).toBe("dist/worker/rb-connect-dev.js");
  const app = await import(join(dir, entry));
  expect(typeof app.Gate).toBe("function");   // the app's other exports stay the Worker's
  expect(await (await app.default.fetch(new Request("http://x/"), {}, { waitUntil() {} })).text()).toBe("http still here");
  const { socketOf } = await import(join(dir, "dist/worker/rb-connect.js"));

  // workerd's side: the upgraded WebSocket as the FrameSocket the adapter reads, then connect() as withConnect calls it.
  const sockets = new Map<ServerWebSocket<unknown>, Map<string, ((e: { data: unknown }) => void)[]>>();
  const emit = (ws: ServerWebSocket<unknown>, type: string, data?: unknown) => { for (const f of sockets.get(ws)?.get(type) ?? []) f({ data }); };
  const http = await freePort();
  const worker = Bun.serve({
    hostname: "127.0.0.1", port: http,
    fetch: (req, srv) => new URL(req.url).pathname === CONNECT_PATH && srv.upgrade(req) ? undefined : new Response("no", { status: 404 }),
    websocket: {
      open(ws) {
        const on = new Map<string, ((e: { data: unknown }) => void)[]>();
        sockets.set(ws, on);
        const frames: FrameSocket = { send: (d) => { ws.send(d); }, close: (code) => ws.close(code), addEventListener: (t: string, f: (e: { data: unknown }) => void) => { on.set(t, [...on.get(t) ?? [], f]); } };
        const socket: InboundSocket = socketOf(frames);
        Promise.resolve(app.default.connect(socket, {}, { waitUntil() {} })).finally(() => socket.close());
      },
      message: (ws, m) => emit(ws, "message", m),
      close: (ws) => emit(ws, "close"),
    },
  });
  const tcp = await freePort();
  const bridge = await bridgeConnect(tcp, connectUrl(http));
  try {
    const heard = await new Promise<string>((ok, fail) => {
      let got = "";
      const c = dial({ host: "127.0.0.1", port: tcp, allowHalfOpen: true }, () => { c.write("hello "); c.end("git"); });
      c.on("data", (d) => { got += d.toString(); });
      c.on("end", () => ok(got));
      c.on("error", fail);
    });
    expect(heard).toBe("you said HELLO GIT");
  } finally {
    bridge.close();
    worker.stop(true);
  }
});
