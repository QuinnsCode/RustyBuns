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
