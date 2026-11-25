import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Fleet } from "../src/api.ts";
import { demoFleet } from "../src/demo.ts";
import { MODES, layout } from "../src/layout.ts";
import { boxFaces, camFor } from "../src/project.ts";
import { scan } from "../src/scan.ts";
import { api } from "../src/server.ts";

const root = mkdtempSync(join(tmpdir(), "hemyviz-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const SECRET = "sk_live_do_not_show_me";
/** A state row the way Alchemy writes it (alchemy/src/State/ResourceState.ts), a secret in its props and attr. */
const row = (type: string, status: string, downstream: string[], extra: Record<string, unknown> = {}) => ({
  kind: "resource", resourceType: type, fqn: "", logicalId: "", instanceId: "i", providerVersion: 1, status, downstream, bindings: [{ sid: "b", data: {} }],
  props: { name: "x", token: { __redacted__: SECRET } }, attr: { url: "https://shop.example.workers.dev/", workerName: "shop", apiToken: { __redacted__: SECRET }, connectionString: `postgres://u:${SECRET}@db/x` },
  ...extra,
});
const put = (dir: string, file: string, v: unknown) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, file), JSON.stringify(v)); };

test("a deploy's state, drawn: the stacks and edges come through, a deploy in flight shows, no secret ever leaves", async () => {
  const state = join(root, "state");
  put(join(state, "shop", "prod"), "DB.json", row("Cloudflare.D1.Database", "created", ["Worker"], { removalPolicy: "retain" }));
  put(join(state, "shop", "prod"), "Worker.json", row("Cloudflare.Worker", "updating", []));
  put(join(state, "shop", "prod"), "Api__Route.json", row("Cloudflare.DNS", "created", []));
  put(join(state, "shop", "prod"), "__stack_output__.json", { url: "x" });
  put(join(state, "shop", "prod"), "Seed.json", { kind: "action", status: "created" });
  put(join(state, "shop", "prod"), "broken.json", "{not json");
  writeFileSync(join(state, "shop", "prod", "broken.json"), "{not json");
  put(join(state, "blog", "preview"), "Worker.json", row("Cloudflare.Worker", "created", []));
  // A cross-app ref links another app's stack dir into this state: read once, not twice.
  symlinkSync(join(state, "blog"), join(state, "blog-link"));

  const call = api(() => scan([{ dir: state, app: "apps/shop" }]));
  const res = call(new Request("http://x/api/fleet"));
  const text = await res.text();
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("__redacted__");
  const fleet = Fleet(JSON.parse(text));
  expect(fleet.stacks.map((s) => s.id)).toEqual(["blog/preview", "shop/prod"]);
  const shop = fleet.stacks.find((s) => s.id === "shop/prod")!;
  expect(shop.resources.map((r) => [r.fqn, r.status, r.kept])).toEqual([["Api/Route", "created", false], ["DB", "created", true], ["Worker", "updating", false]]);
  expect(shop.resources.find((r) => r.fqn === "Worker")).toMatchObject({ name: "shop", url: "https://shop.example.workers.dev/", bindings: 1, props: 2 });

  // Nothing changed on disk: the page's next ask is a 204.
  expect(call(new Request(`http://x/api/fleet?since=${fleet.version}`)).status).toBe(204);
  put(join(state, "shop", "prod"), "Queue.json", row("Cloudflare.Queue", "creating", ["Worker"]));
  expect(call(new Request(`http://x/api/fleet?since=${fleet.version}`)).status).toBe(200);

  const scene = layout(Fleet(JSON.parse(await call(new Request("http://x/api/fleet")).text())), "health");
  expect(scene.blocks.filter((b) => b.pulse).map((b) => b.r.fqn).sort()).toEqual(["Queue", "Worker"]);
});

test("every mode places every resource once, without two on one spot, and the same state draws the same scene", () => {
  const fleet = demoFleet(), total = fleet.stacks.reduce((n, s) => n + s.resources.length, 0);
  for (const mode of MODES) {
    const s = layout(fleet, mode);
    expect(s.blocks.length).toBe(total);
    expect(new Set(s.blocks.map((b) => b.id)).size).toBe(total);
    for (const a of s.blocks) for (const b of s.blocks)
      if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.z + a.d <= b.z || b.z + b.d <= a.z).toBe(true);
    for (const z of s.zones) for (const y of s.zones)
      if (z !== y) expect(z.x + z.w <= y.x || y.x + y.w <= z.x || z.z + z.d <= y.z || y.z + y.d <= z.z).toBe(true);
    expect(layout(demoFleet(), mode)).toEqual(s);
  }
  // Blast: the box's server feeds three services; the eqosys DB only its Worker and the Worker's route.
  const blast = layout(fleet, "blast");
  expect(blast.blocks.find((b) => b.id === "box/prod::Server")!.reach).toBe(3);
  expect(blast.blocks.find((b) => b.id === "eqosys/prod::DB")!.reach).toBe(2);
  expect(layout(fleet, "map", ["qollab/prod"]).blocks.every((b) => b.stack === "qollab")).toBe(true);
});

test("each camera sees the faces it should: the map only tops, 2.5D and 3D a top and two sides", () => {
  const box = { x: 0, z: 0, w: 1, d: 1, h: 2 };
  const seen = (dim: "2d" | "2.5d" | "3d") => boxFaces(camFor(dim, 5, 5, 10), 800, 600, 40, box).map((f) => f.name).sort();
  expect(seen("2d")).toEqual(["top"]);
  expect(seen("2.5d")).toEqual(["east", "south", "top"]);
  expect(seen("3d")).toEqual(["east", "south", "top"]);
});
