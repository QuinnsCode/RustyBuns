import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { nudged } from "../src/nudge.ts";

setDefaultTimeout(120_000);
const APP = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(APP, p));

describe("nudged", () => {
  const sheet = { id: "x", nodes: { head: [1, 2, 3, 0.2, "extra"] } };
  test.each([
    [{ dx: 0.1, dz: -0.5 }, [1.1, 2, 2.5, 0.2]],
    [{ dr: -1 }, [1, 2, 3, 0.005]], // a radius never goes to nothing
  ])("%o", (d, to) => {
    const n = { id: "x", node: "head", dx: 0, dy: 0, dz: 0, dr: 0, ...d };
    expect(Reflect.get(Reflect.get(nudged(sheet, n) as object, "nodes"), "head")).toEqual([...to, "extra"]);
  });
  test("a node the sheet lacks is refused", () => {
    expect(() => nudged(sheet, { id: "x", node: "wing", dx: 0, dy: 0, dz: 0, dr: 0 })).toThrow('no node "wing"');
  });
});

// The journey an agent takes: nudge a node over the dev server, and the beast's GLB is rebuilt.
describe.skipIf(!Bun.which("blender"))("the dev server's nudge route", () => {
  let vite: ViteDevServer, base: string;
  const files = ["beasts/jackalope.json", "public/models/jackalope.glb", "public/models/jackalope.rig.json"];
  const before = new Map<string, Buffer>();
  beforeAll(async () => {
    for (const f of files) before.set(f, read(f));
    vite = await createServer({ root: APP, server: { port: 0, host: "127.0.0.1" }, logLevel: "silent" });
    await vite.listen();
    base = `http://127.0.0.1:${vite.config.server.port}`;
  });
  afterAll(async () => {
    for (const [f, b] of before) writeFileSync(join(APP, f), b);
    await vite?.close();
  });

  test("moving a node changes the GLB", async () => {
    const sheets = await (await fetch(`${base}/__beast/sheets`)).json();
    expect(sheets).toContainEqual({ id: "jackalope", budget: expect.any(Number) });
    const glb = async () => Buffer.from(await (await fetch(`${base}/models/jackalope.glb`)).arrayBuffer());
    const was = await glb();
    const post = (b: unknown) => fetch(`${base}/__beast/nudge`, { method: "POST", body: JSON.stringify(b) });
    expect((await post({ id: "jackalope", node: "no-such-node", dx: 0.1 })).status).toBe(404);
    expect((await post({ id: "../../etc", node: "tail", dx: 0.1 })).status).toBe(400);
    const r = await post({ id: "jackalope", node: "tail", dx: 0.05, dy: 0.04, dr: 0.01 });
    expect(r.status).toBe(200);
    expect(Buffer.compare(was, await glb())).not.toBe(0);
  });
});
