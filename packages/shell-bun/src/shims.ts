// HOST-SIDE shim for `cloudflare:workers` and `rwsdk/worker`, bundled into the
// desktop binary in place of the real modules. Actions and db modules that do
// `import { env } from "cloudflare:workers"` get the host's env (sqlite D1, KV,
// in-process DOs); `requestInfo` is the one local identity.
declare global { var __RB_ENV: Record<string, unknown> | undefined; var __RB_IDENTITY: Record<string, string> | undefined; }

export const env: Record<string, any> = new Proxy({}, {
  get: (_t, k) => globalThis.__RB_ENV?.[k as string],
  has: (_t, k) => !!globalThis.__RB_ENV && k in globalThis.__RB_ENV,
  ownKeys: () => Object.keys(globalThis.__RB_ENV ?? {}),
  getOwnPropertyDescriptor: (_t, k) => ({ enumerable: true, configurable: true, value: globalThis.__RB_ENV?.[k as string] }),
});

export class DurableObject<E = unknown> {
  constructor(public ctx: any, public env: E) {}
}
export class WorkerEntrypoint<E = unknown> { constructor(public ctx: any, public env: E) {} }

/** rwsdk/worker's requestInfo, local edition. */
export const requestInfo = {
  get ctx() { const id = globalThis.__RB_IDENTITY ?? {}; return { user: { id: id["X-User-Id"] ?? "local", name: id["X-User-Name"] ?? "local" }, session: null }; },
  get headers() { return new Headers(globalThis.__RB_IDENTITY ?? {}); },
  request: null as Request | null,
  response: { headers: new Headers(), status: 200 },
};
export const waitUntil = (p: Promise<unknown>) => { void p.catch((e) => console.error("[waitUntil]", e)); };
export const defineApp = (routes: unknown) => ({ fetch: async () => new Response("rwsdk app is not run on the desktop; use spa mode", { status: 501 }), routes });
export const route = (..._a: unknown[]) => null;
export const render = (..._a: unknown[]) => null;
export const prefix = (..._a: unknown[]) => null;
