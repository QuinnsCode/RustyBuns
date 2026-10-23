// The smaller twins: Vectorize, Analytics Engine, Workers AI and the Worker Loader.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalVectorize } from "../src/bindings/vectorize.ts";
import { LocalAnalyticsEngine } from "../src/bindings/analytics.ts";
import { LocalAi } from "../src/bindings/ai.ts";
import { LocalWorkerLoader } from "../src/bindings/worker-loader.ts";

test("vectorize: upsert, query by cosine with metadata filters, getByIds, deleteByIds", async () => {
  const v = new LocalVectorize(":memory:", "idx", { dimensions: 3 });
  await v.upsert([
    { id: "a", values: [1, 0, 0], metadata: { repo: "x", stars: 5 } },
    { id: "b", values: [0.9, 0.1, 0], metadata: { repo: "y", stars: 50 } },
    { id: "c", values: [0, 1, 0], namespace: "other", metadata: { repo: "x", stars: 1 } },
  ]);
  await v.insert([{ id: "a", values: [0, 0, 1] }]);
  const all = await v.query([1, 0, 0], { topK: 2, returnMetadata: true });
  expect(all.matches.map((m) => m.id)).toEqual(["a", "b"]);
  expect(all.matches[0]!.score).toBeCloseTo(1);
  expect(all.matches[0]!.metadata).toEqual({ repo: "x", stars: 5 });
  expect((await v.query([1, 0, 0], { filter: { repo: "x", stars: { $lt: 3 } } })).matches.map((m) => m.id)).toEqual(["c"]);
  expect((await v.query([1, 0, 0], { namespace: "other", returnValues: true })).matches).toEqual([{ id: "c", score: 0, namespace: "other", values: [0, 1, 0] }]);
  expect((await v.getByIds(["b", "zz"])).map((r) => r.id)).toEqual(["b"]);
  await v.deleteByIds(["a"]);
  expect((await v.describe()).vectorCount).toBe(2);
  await expect(v.upsert([{ id: "d", values: [1, 2] }])).rejects.toThrow(/dimensions/);
  const e = new LocalVectorize(":memory:", "e", { metric: "euclidean" });
  await e.upsert([{ id: "far", values: [5, 5] }, { id: "near", values: [1, 1] }]);
  expect((await e.query([0, 0])).matches.map((m) => m.id)).toEqual(["near", "far"]);
});

test("analytics engine: points land in sqlite", () => {
  const ae = new LocalAnalyticsEngine(":memory:", "events");
  ae.writeDataPoint({ indexes: ["user1"], blobs: ["click", null], doubles: [1.5] });
  const [p] = ae.points();
  expect(p).toMatchObject({ index: "user1", blobs: ["click", null], doubles: [1.5] });
  expect(() => ae.writeDataPoint({ indexes: ["a", "b"] })).toThrow(/one index/);
});

test("workers ai: embeds bge text locally (shared words are near), everything else says it runs only on Cloudflare", async () => {
  const ai = new LocalAi("AI");
  const r: any = await ai.run("@cf/baai/bge-small-en-v1.5", { text: ["search the index", "searching indexes", "bake a cake"] });
  expect(r.shape).toEqual([3, 384]);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  expect(dot(r.data[0], r.data[1])).toBeGreaterThan(dot(r.data[0], r.data[2]));
  expect((await ai.run("@cf/baai/bge-base-en-v1.5", { text: "x" }) as any).shape).toEqual([1, 768]);
  await expect(ai.run("@cf/meta/llama-3-8b-instruct", { prompt: "hi" })).rejects.toThrow(/AI.*only on Cloudflare/);
});

test("worker loader: get() runs getCode once per id; fetch, RPC and a WorkerEntrypoint class", async () => {
  const loader = new LocalWorkerLoader(mkdtempSync(join(tmpdir(), "rb-loader-")));
  let made = 0;
  const code = () => {
    made++;
    return {
      mainModule: "main.js",
      modules: {
        "main.js": `import greeting from "./hello.txt";
import { WorkerEntrypoint } from "cloudflare:workers";
import { double } from "./lib.js";
export default { fetch: (req, env) => new Response(greeting + " " + new URL(req.url).pathname + " " + env.WHO), add: (a, b) => a + b };
export class Math2 extends WorkerEntrypoint { twice(n) { return double(n) + this.env.BUMP; } }`,
        "lib.js": { js: "export const double = (n) => n * 2;" },
        "hello.txt": { text: "hello" },
      },
      env: { WHO: "you", BUMP: 1 },
    };
  };
  const w = loader.get("w1", code);
  const r = await w.getEntrypoint().fetch!("http://x/path");
  expect(await r.text()).toBe("hello /path you");
  expect(await w.getEntrypoint().add!(2, 3)).toBe(5);
  expect(await loader.get("w1", code).getEntrypoint("Math2").twice!(4)).toBe(9);
  expect(made).toBe(1);
  await expect(loader.load({ mainModule: "x.js", modules: {} }).getEntrypoint().fetch!("http://x/")).rejects.toThrow(/mainModule/);
});
