// The Worker's bindings (rustybuns.config.ts), as src/env.ts types them. @cloudflare/workers-types stays out of
// this project: its Response clashes with the local twins @rustybuns/shell-bun gives the tests.
declare module "cloudflare:workers" {
  export const env: import("./env.ts").Env & { ASSETS?: { fetch(req: Request): Promise<Response> } };
}
declare module "*.sql?raw" { const sql: string; export default sql; }
