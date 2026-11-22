// The one binding type this app reads. (@cloudflare/workers-types has the full set.)
interface KVNamespace { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
