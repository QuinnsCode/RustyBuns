// The binding types this app reads. (`wrangler types` would generate Env from wrangler.jsonc;
// @cloudflare/workers-types has the full set.)
interface KVNamespace { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void }
interface Env { COUNTER: KVNamespace }

// The server build the Worker entry imports. `react-router typegen` writes this into .react-router/types,
// which isn't checked in, so it's declared here for the repo's typecheck.
declare module "virtual:react-router/server-build" {
  const build: import("react-router").ServerBuild;
  export = build;
}
