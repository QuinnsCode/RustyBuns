// An Astro API route: the form posts here, the count goes up by one in KV, back to `/`.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const POST: APIRoute = async ({ redirect }) => {
  const n = Number((await env.COUNTER.get("count")) ?? 0) + 1;
  await env.COUNTER.put("count", String(n));
  return redirect("/", 303);
};
