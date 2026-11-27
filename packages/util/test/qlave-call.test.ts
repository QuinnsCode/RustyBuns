// A call joining a room over a real socket: the room's own fields reach the app, an app's own frames (captions)
// arrive as they were sent, a frame of a known kind with the wrong shape is dropped, and server errors are passed on.
import { afterAll, expect, test } from "bun:test";
import { QlaveCall } from "../src/qlave-call.ts";

const sent: unknown[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
  websocket: {
    message(ws, data) {
      const m: unknown = JSON.parse(String(data));
      sent.push(m);
      if (m && typeof m === "object" && "type" in m && m.type === "join") {
        // No one else is in the room, so no peer connection is made; `peers` carries junk the call must skip.
        ws.send(JSON.stringify({ type: "joined", peers: [42, null], peerNames: "nope", resume: "r1", self: { sub: "s1" } }));
        ws.send(JSON.stringify({ type: "peer-left", peerId: 7 }));
        ws.send(JSON.stringify({ type: "caption", from: "p2", text: "hello", at: 3 }));
        ws.send(JSON.stringify({ type: "error", message: "room is full" }));
      }
    },
  },
});
afterAll(() => server.stop(true));

const detail = (e: Event): unknown => (e instanceof CustomEvent ? e.detail : undefined);

test("a call joins, hands on the room and the app's own frames, and drops the wrong shapes", async () => {
  const call = new QlaveCall({ signalingUrl: `ws://localhost:${server.port}/__qlave/room`, name: "Ada" });
  const joined: unknown[] = [], messages: unknown[] = [], errors: unknown[] = [], left: unknown[] = [];
  call.addEventListener("joined", (e) => joined.push(detail(e)));
  call.addEventListener("message", (e) => messages.push(detail(e)));
  call.addEventListener("server-error", (e) => errors.push(detail(e)));
  call.addEventListener("peer-left", (e) => left.push(detail(e)));
  const gotError = new Promise((done) => call.addEventListener("server-error", done, { once: true }));

  await call.join();
  await gotError;

  expect(call.state).toBe("joined");
  expect(call.remotePeers).toEqual([]);
  expect(joined).toEqual([{ peerId: call.peerId, room: expect.objectContaining({ resume: "r1", self: { sub: "s1" } }) }]);
  expect(messages).toEqual([{ type: "caption", from: "p2", text: "hello", at: 3 }]);
  expect(errors).toEqual([{ type: "error", message: "room is full" }]);
  expect(left).toEqual([]);
  expect(sent).toContainEqual({ type: "join", name: "Ada" });
  call.leave();
});
