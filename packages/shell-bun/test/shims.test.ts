import { test, expect } from "bun:test";
import { serverQuery, serverAction, registerServerFunctionWrap } from "../src/shims.ts";

test("serverQuery / serverAction: call the handler, with rwsdk's default methods", async () => {
  const q = serverQuery(async (a: number, b: number) => a + b);
  const a = serverAction(async (s: string) => s.toUpperCase(), { method: "GET" });
  expect(await q(2, 3)).toBe(5);
  expect(q.method).toBe("GET");
  expect(await a("hi")).toBe("HI");
  expect(a.method).toBe("GET");
  expect(serverAction(async () => 1).method).toBe("POST");
});

test("interruptors run first; a Response from one ends the call", async () => {
  const seen: unknown[] = [];
  const ok = serverAction([({ args }: any) => { seen.push(args); }, async (n: number) => n * 2]);
  expect(await ok(4)).toBe(8);
  expect(seen).toEqual([[4]]);
  let ran = false;
  const denied = serverQuery([() => new Response("no", { status: 401 }), async () => { ran = true; }]);
  const r = await denied();
  expect(r).toBeInstanceOf(Response);
  expect((r as Response).status).toBe(401);
  expect(ran).toBe(false);
});

test("registerServerFunctionWrap runs around the handler and knows its type", async () => {
  const types: string[] = [];
  registerServerFunctionWrap(async (fn, args, type) => { types.push(type); return fn(...args); });
  try {
    expect(await serverQuery(async () => "q")()).toBe("q");
    expect(await serverAction(async () => "a")()).toBe("a");
    expect(types).toEqual(["query", "action"]);
  } finally { registerServerFunctionWrap(undefined as any); }
});

test("cloudflare:workers base classes exist to extend, RpcTarget too (capnweb extends it at load)", async () => {
  const workers = await import("../src/shims.ts");
  class Api extends workers.RpcTarget { hi() { return "hi"; } }
  expect(new Api().hi()).toBe("hi");
  for (const k of ["DurableObject", "WorkerEntrypoint", "WorkflowEntrypoint", "RpcTarget"] as const) expect(typeof workers[k]).toBe("function");
});

test("workerd-global: globalThis.Cloudflare.compatibilityFlags, true for the flags the app lists", async () => {
  const g = globalThis as any;
  const before = g.Cloudflare;
  delete g.Cloudflare;
  g.RB_COMPAT_FLAGS = "nodejs_compat,global_fetch_strictly_public";
  try {
    await import(`../src/workerd-global.ts?${Date.now()}`);
    expect(g.Cloudflare.compatibilityFlags).toEqual({ nodejs_compat: true, global_fetch_strictly_public: true });
    expect(g.Cloudflare.compatibilityFlags.enable_nodejs_process_v2).toBeUndefined();
  } finally { delete g.RB_COMPAT_FLAGS; g.Cloudflare = before; }
});

test("getRequestInfo is requestInfo; defineScript runs its function with the env", async () => {
  const { getRequestInfo, requestInfo, defineScript } = await import("../src/shims.ts");
  expect(getRequestInfo()).toBe(requestInfo);
  (globalThis as any).__RB_ENV = { DB: "db" };
  try { expect(await defineScript(async ({ env }) => env.DB)()).toBe("db"); }
  finally { delete (globalThis as any).__RB_ENV; }
});
