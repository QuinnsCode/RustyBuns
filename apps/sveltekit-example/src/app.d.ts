// The one binding type this app reads (@cloudflare/workers-types has the full set), and the bindings in
// wrangler.jsonc as SvelteKit 3 on adapter-cloudflare hands them out: `import { env } from "cloudflare:workers"`.
interface KVNamespace { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
declare module "cloudflare:workers" { export const env: { COUNTER: KVNamespace } }
