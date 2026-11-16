// A shop wires QView3D into its own tools: it adds a webhook with its script key, a shopper saves a design (the
// shop's receiver is down, so it is tried again), the store posts the order, and the receiver gets a signed
// order.ready with the print files' links, which it checks the way the docs say. Sent twice, the order fires once.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { Delivery, HookEvent, HookReply, Hooks, OrderReply, SignReply } from "../src/api.ts";
import { SIGNATURE, verifyHook } from "../src/hook-sign.ts";
import { retryDue } from "../src/hooks.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";
import { embedGuide } from "../src/embed.ts";

setDefaultTimeout(20_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-hooks-"));
const got: { sig: string | null; event: string | null; body: string }[] = [];
let down = 1; // the receiver answers 503 this many times first
const receiver = Bun.serve({
  port: 0,
  async fetch(req) {
    got.push({ sig: req.headers.get(SIGNATURE), event: req.headers.get("QView3D-Event"), body: await req.text() });
    return down-- > 0 ? new Response("down", { status: 503 }) : new Response("ok");
  },
});
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { app = await local({ dir }); });
afterAll(() => { app.stop(); receiver.stop(true); rmSync(dir, { recursive: true, force: true }); });

const admin = { authorization: `Bearer ${DEMO_ADMIN}` };
const call = (path: string, method: string, body?: unknown, h: Record<string, string> = admin) =>
  fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });

async function upload(kind: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const s = SignReply(await (await call("/api/orgs/demo/uploads", "POST", { kind, type, size: bytes.length, sha256: hex(await crypto.subtle.digest("SHA-256", bytes)) })).json());
  if (!s.exists) expect((await fetch(s.put!.url, { method: "PUT", headers: s.put!.headers, body: bytes })).status).toBe(201);
  return s.key;
}

test("a design saved, an order posted: the shop's receiver gets a signed order.ready with the print files", async () => {
  expect((await call("/api/orgs/demo/hooks", "POST", { url: `http://localhost:${receiver.port}/qv` }, {})).status).toBe(401);
  expect((await call("/api/orgs/demo/hooks", "POST", { url: "http://shop.example/qv" })).status).toBe(400); // https only, off this machine
  const hook = HookReply(await (await call("/api/orgs/demo/hooks", "POST", { url: `http://localhost:${receiver.port}/qv` })).json());

  // A shopper saves a cap with their original; the receiver is down, so design.saved waits for a retry.
  const layer = { texture: await upload("texture", "image/webp", new Uint8Array([7, 7])), original: await upload("original", "image/png", new Uint8Array([137, 80, 78, 71, 9])), u: 0.5, v: 0.5, scale: 0.6, rotation: 0 };
  const saved = await call("/api/orgs/demo/designs", "POST", { v: 1, model: "cap", color: "#1f2937", product: "field-cap", layers: [layer], camera: { azimuth: 0, polar: 1.2, distance: 5 } }, { origin: "https://shop.test" });
  const { id: design } = (await saved.json()) as { id: string };
  expect(got.map((g) => g.event)).toEqual(["design.saved"]);
  let log = Hooks(await (await call("/api/orgs/demo/hooks", "GET")).json());
  expect(log.deliveries[0]).toMatchObject({ event: "design.saved", status: "pending", attempts: 1, code: 503 });
  expect(await retryDue(app.bindings, log.deliveries[0]!.next! + 1)).toBe(1);
  expect(got[1]!.body).toBe(got[0]!.body); // the same event, signed again
  expect(HookEvent(JSON.parse(got[1]!.body)).data).toMatchObject({ design, model: "cap", product: "field-cap" });

  // The store posts the order with the script key: recorded, print files laid out, order.ready sent.
  const order = { id: "#1001", lines: [{ design, qty: 2 }] };
  const res = await call("/api/orgs/demo/orders", "POST", order);
  expect(res.status).toBe(201);
  const reply = OrderReply(await res.json());
  expect(reply.lines[0]).toMatchObject({ design, qty: 2, sheets: [{ zone: "front", px: { w: 1417, h: 709 } }] });

  // The receiver checks the signature as /v1/embed.md shows: the raw body, the header, the secret it was shown once.
  const last = got.at(-1)!;
  expect(last.event).toBe("order.ready");
  const js = [...embedGuide(app.url).matchAll(/```js\n([\s\S]*?)```/g)].at(-1)![1]!; // section 9's receiver
  const fromQView3D = new Function(`${js}; return fromQView3D;`)() as (req: Request, secret: string) => Promise<unknown>;
  const delivered = (sig: string | null, body: string) => new Request(receiver.url, { method: "POST", body, headers: sig ? { [SIGNATURE]: sig } : {} });
  expect(HookEvent(await fromQView3D(delivered(last.sig, last.body), hook.secret)).type).toBe("order.ready");
  expect(await fromQView3D(delivered(last.sig, last.body), "whsec_someone-else")).toBeNull();
  expect(await verifyHook(hook.secret, last.sig, last.body)).toBe(true);
  expect(await verifyHook(hook.secret, last.sig, last.body.replace("1001", "1002"))).toBe(false);
  expect(await verifyHook("whsec_someone-else", last.sig, last.body)).toBe(false);
  const ev = HookEvent(JSON.parse(last.body));
  expect(ev).toMatchObject({ type: "order.ready", org: "demo", data: { order: "#1001" } });
  expect((await fetch(ev.data.lines![0]!.sheets[0]!.original, { headers: admin })).status).toBe(200);

  // The store retries its call: same order back, nothing fires twice. A design that isn't the org's is refused.
  const again = OrderReply(await (await call("/api/orgs/demo/orders", "POST", order)).json());
  expect(again).toMatchObject({ id: "#1001", fresh: false });
  expect(got.filter((g) => g.event === "order.ready")).toHaveLength(1);
  expect((await call("/api/orgs/demo/orders", "POST", { id: "#1002", lines: [{ design: "0".repeat(24) }] })).status).toBe(400);

  // Send test, then the log the shop sees on /orgs.html.
  expect(Delivery(await (await call(`/api/orgs/demo/hooks/${hook.id}/test`, "POST", {})).json())).toMatchObject({ event: "test", status: "ok", code: 200 });
  log = Hooks(await (await call("/api/orgs/demo/hooks", "GET")).json());
  expect(log.hooks).toMatchObject([{ id: hook.id, events: ["design.saved", "order.ready"] }]);
  expect(log.deliveries.map((d) => `${d.event} ${d.status}`)).toEqual(["test ok", "order.ready ok", "design.saved ok"]);
});
