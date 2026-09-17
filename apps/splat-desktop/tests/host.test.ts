import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import host, { _reset } from "../desktop/host.ts";
import { makeTestSplat } from "../scripts/make-test-splat.ts";

const root = mkdtempSync(join(tmpdir(), "splat-"));
const lib = join(root, "My Scenes");
const ctx = { env: {}, dataDir: join(root, "data"), identity: {}, reporter: { breadcrumb() {}, report() {}, escaped() {} } } as any;
const call = async (path: string, init?: RequestInit) => (await host.fetch(new Request(`http://local${path}`, init), ctx))!;
const splat = makeTestSplat(500);

beforeAll(() => {
  mkdirSync(join(lib, "nested"), { recursive: true });
  mkdirSync(ctx.dataDir, { recursive: true });
  writeFileSync(join(lib, "ring.ply"), splat);
  writeFileSync(join(lib, "nested", "100% done.spz"), "fake");
  writeFileSync(join(lib, "notes.txt"), "not a scene");
  writeFileSync(join(root, "secret.ply"), "outside the library");
  _reset();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("not our route: falls through", async () => {
  expect(await host.fetch(new Request("http://local/editor/"), ctx)).toBeNull();
});

test("nothing works before a library is open", async () => {
  expect((await call("/api/library/scenes")).status).toBe(400);
  expect((await call("/files/ring.ply")).status).toBe(404);
});

test("open a library, list only scene files, remember it", async () => {
  const r = await call("/api/library/open", { method: "POST", body: JSON.stringify({ dir: lib }) });
  expect(r.status).toBe(200);
  const { scenes } = await (await call("/api/library/scenes")).json();
  expect(scenes.map((s: any) => s.path)).toEqual(["nested/100% done.spz", "ring.ply"]);
  expect(scenes[1].bytes).toBe(splat.length);
  const st = await (await call("/api/status")).json();
  expect(st.library.name).toBe("My Scenes");
  expect(st.recent[0]).toBe(lib);
});

test("serve a whole file", async () => {
  const r = await call("/files/ring.ply");
  expect(r.status).toBe(200);
  expect(r.headers.get("accept-ranges")).toBe("bytes");
  expect(new Uint8Array(await r.arrayBuffer())).toEqual(splat as Uint8Array<ArrayBuffer>);
});

test("serve byte ranges, including open-ended and suffix ranges", async () => {
  const mid = await call("/files/ring.ply", { headers: { range: "bytes=10-19" } });
  expect(mid.status).toBe(206);
  expect(mid.headers.get("content-range")).toBe(`bytes 10-19/${splat.length}`);
  expect(new Uint8Array(await mid.arrayBuffer())).toEqual(splat.slice(10, 20));
  const tail = await call("/files/ring.ply", { headers: { range: "bytes=-8" } });
  expect(new Uint8Array(await tail.arrayBuffer())).toEqual(splat.slice(-8));
  const open = await call("/files/ring.ply", { headers: { range: `bytes=${splat.length - 4}-` } });
  expect(new Uint8Array(await open.arrayBuffer())).toEqual(splat.slice(-4));
  expect((await call("/files/ring.ply", { headers: { range: `bytes=${splat.length}-` } })).status).toBe(416);
  expect((await call("/files/ring.ply", { headers: { range: "bytes=5-2" } })).status).toBe(416);
});

test("encoded names work", async () => {
  const r = await call(`/files/nested/${encodeURIComponent("100% done.spz")}`);
  expect(await r.text()).toBe("fake");
});

test("no escaping the library, no non-scene files", async () => {
  expect((await call("/files/..%2Fsecret.ply")).status).toBe(404);
  // URL parsing turns /files/../secret.ply into /secret.ply: not a host route at all
  expect(await host.fetch(new Request("http://local/files/../secret.ply"), ctx)).toBeNull();
  expect((await call("/files/notes.txt")).status).toBe(404);
  expect((await call("/files/nested")).status).toBe(404);
});

test("the test splat is a valid 3DGS PLY header", () => {
  const head = new TextDecoder().decode(splat.slice(0, 600));
  expect(head.startsWith("ply\nformat binary_little_endian 1.0\nelement vertex 500\n")).toBe(true);
  expect(head).toContain("property float f_dc_0");
  expect(head).toContain("end_header\n");
  expect(splat.length).toBe(head.indexOf("end_header\n") + 11 + 500 * 17 * 4);
});

test("scene info route: reads the file, refuses escapes", async () => {
  const info = await (await call("/api/library/info?path=ring.ply")).json();
  expect(info.splats).toBe(500);
  expect((await call("/api/library/info?path=../secret.ply")).status).toBe(404);
  expect((await call("/api/library/info?path=notes.txt")).status).toBe(404);
});
