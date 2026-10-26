// The bindings as the entry sees them: unknown until worker.ts looks.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
