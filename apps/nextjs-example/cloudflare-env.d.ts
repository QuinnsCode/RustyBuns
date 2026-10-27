// The one binding type this app reads (@cloudflare/workers-types has the full set), declared on
// OpenNext's CloudflareEnv so getCloudflareContext().env.COUNTER is typed.
interface KVNamespace { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }

declare global {
  interface CloudflareEnv {
    COUNTER: KVNamespace;
  }
}

export {};
