import { test, expect, setDefaultTimeout } from "bun:test";
import { localUrl, runTests, testFlags, waitReady, type TestDeps } from "../src/test-run.ts";

setDefaultTimeout(20_000);

const up = (async () => new Response("ok")) as unknown as typeof fetch;

function deps(over: Partial<TestDeps> = {}) {
  const calls: string[] = [];
  const d: TestDeps = {
    log: () => {},
    cli: async (a) => { calls.push(a.join(" ")); return 0; },
    start: (a) => {
      calls.push(`start ${a.join(" ")}`);
      return { exited: new Promise<number>(() => {}), output: () => "ready on http://localhost:1337\n", stop: async () => { calls.push("stop dev"); } };
    },
    bunTest: async (f, env) => { calls.push(`bun test ${f.join(" ")} ${env.RUSTYBUNS_TEST_URL}`); return 0; },
    stageUrl: (s) => `https://app-${s}.example.workers.dev`,
    priced: async () => null,
    fetch: up,
    readyMs: 0,
    ...over,
  };
  return { d, calls };
}

test("flags: local by default, --stage alone is test_$USER, a name only after =", () => {
  expect(testFlags([], { USER: "ann" })).toEqual({ stage: null, url: undefined, yes: false, keep: false, filters: [] });
  expect(testFlags(["--stage", "checkout"], { USER: "ann" })).toMatchObject({ stage: "test_ann", filters: ["checkout"] });
  expect(testFlags(["--stage=ci-pr-42", "--yes"]).stage).toBe("ci-pr-42");
  expect(() => testFlags(["--keep"])).toThrow(/--keep is for --stage/);
  expect(() => testFlags(["--stage=bad name"])).toThrow(/needs a name/);
});

test("localUrl: the first local address in dev's output", () => {
  expect(localUrl("workerd up\n  Worker: http://localhost:1337/ (local)\n")).toBe("http://localhost:1337/");
  expect(localUrl("listening at http://0.0.0.0:8787.")).toBe("http://localhost:8787");
  expect(localUrl("deploying https://x.workers.dev")).toBeNull();
});

test("waitReady: retries a refused connection and Cloudflare's 'nothing here yet'", async () => {
  let n = 0;
  const f = (async () => {
    n++;
    if (n === 1) throw new Error("ECONNREFUSED");
    if (n === 2) return new Response("error code: 1042", { status: 404 });
    return new Response("hi", { status: 200 });
  }) as unknown as typeof fetch;
  expect(await waitReady("http://x", { fetch: f, everyMs: 1 })).toEqual({ ok: true, status: 200 });
  expect(n).toBe(3);
});

test("local run: dev up, tests against its address, dev stopped; nothing deployed", async () => {
  const { d, calls } = deps();
  expect(await runTests(testFlags([]), d)).toBe(0);
  expect(calls).toEqual(["start dev", "bun test journey http://localhost:1337", "stop dev"]);
});

test("stage run: deploy, test, destroy, and the destroy still runs when a test fails", async () => {
  const { d, calls } = deps({ bunTest: async (f, env) => { calls.push(`bun test ${f.join(" ")} ${env.RUSTYBUNS_TEST_URL}`); return 1; } });
  expect(await runTests(testFlags(["--stage=t1", "checkout"]), d)).toBe(1);
  expect(calls).toEqual([
    "deploy --stage t1 --ephemeral --yes",
    "bun test checkout https://app-t1.example.workers.dev",
    "destroy --stage t1 --ephemeral --yes",
  ]);
});

test("stage run: a failed deploy is destroyed too; a refusal deploys nothing", async () => {
  const a = deps({ cli: async (x) => { a.calls.push(x[0]!); return x[0] === "deploy" ? 1 : 0; } });
  expect(await runTests(testFlags(["--stage"]), a.d)).toBe(1);
  expect(a.calls).toEqual(["deploy", "destroy"]);
  const b = deps({ priced: async () => "no terminal to ask: pass --yes" });
  expect(await runTests(testFlags(["--stage"]), b.d)).toBe(2);
  expect(b.calls).toEqual([]);
});

test("stage run: a failed destroy fails a green run; --keep leaves the stage", async () => {
  const a = deps({ cli: async (x) => (x[0] === "destroy" ? 1 : 0) });
  expect(await runTests(testFlags(["--stage"]), a.d)).toBe(1);
  const b = deps();
  expect(await runTests(testFlags(["--stage", "--keep"]), b.d)).toBe(0);
  expect(b.calls.some((c) => c.startsWith("destroy"))).toBe(false);
});
