// The one binding this app reads, as `import { env } from "cloudflare:workers"` sees it.
// (@cloudflare/workers-types has the full set; this app only needs COUNTER.)
declare module "cloudflare:workers" {
  export const env: {
    COUNTER: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  };
}
