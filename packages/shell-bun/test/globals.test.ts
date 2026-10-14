import { test, expect } from "bun:test";
import { installCloudflareGlobals } from "../src/index.ts";

// The host's Response subclass carries `webSocket`; the Responses Bun makes itself
// (Response.json, Response.redirect, fetch) must still pass `instanceof Response`.
test("installCloudflareGlobals: native Responses are still instanceof Response", () => {
  installCloudflareGlobals();
  expect(Response.json({ ok: true }) instanceof Response).toBe(true);
  expect(Response.redirect("http://x.test/", 302) instanceof Response).toBe(true);
  const ws = {} as any;
  const r = new Response(null, { status: 200, webSocket: ws } as any) as Response & { webSocket?: unknown };
  expect(r instanceof Response).toBe(true);
  expect(r.webSocket).toBe(ws);
  expect({} instanceof Response).toBe(false);
});

test("caches.default exists as soon as the host is imported (SvelteKit reads it at module load)", () => {
  expect((globalThis as any).caches.default).toBeDefined();
});
