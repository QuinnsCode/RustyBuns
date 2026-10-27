// A SolidStart API route: the form posts here, the count goes up by one in KV, back to `/`.
import type { APIEvent } from "@solidjs/start/server";
import { env } from "cloudflare:workers";

export async function POST(_event: APIEvent) {
  const n = Number((await env.COUNTER.get("count")) ?? 0) + 1;
  await env.COUNTER.put("count", String(n));
  return Response.redirect(new URL("/", _event.request.url), 303);
}
