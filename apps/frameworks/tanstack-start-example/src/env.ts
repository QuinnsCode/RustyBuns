// The Worker's bindings (wrangler.jsonc). On the desktop, Rusty Buns backs them with sqlite and a folder.
import { env as raw } from "cloudflare:workers";

type D1 = { prepare(sql: string): { bind(...v: unknown[]): { all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> } } };
type KV = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
export const env = raw as { DB: D1; VISITS: KV };
