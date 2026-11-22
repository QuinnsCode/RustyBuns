import type { H3Event } from "h3";

// The one binding this app reads. (@cloudflare/workers-types has the full set.)
interface KVNamespace { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }

/** The COUNTER KV binding, as Nitro's cloudflare-module preset hands it to a handler. */
export function counter(event: H3Event): KVNamespace {
  const cf = event.context.cloudflare as { env: { COUNTER: KVNamespace } } | undefined;
  if (!cf) throw createError({ statusCode: 500, statusMessage: "no Cloudflare env on this request" });
  return cf.env.COUNTER;
}

export const readCount = async (event: H3Event) => Number((await counter(event).get("count")) ?? 0);
