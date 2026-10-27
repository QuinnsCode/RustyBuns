// A SvelteKit page as its own docs write it: `load` reads a count from KV for the page, and the
// default form action bumps it. Nothing here knows about Rusty Buns; `env.COUNTER` is the Worker's
// binding (SvelteKit 3 on adapter-cloudflare 8 hands bindings out through `cloudflare:workers`, not
// `platform.env`), which the desktop and box hosts back with a folder.
import type { Actions, ServerLoad } from "@sveltejs/kit";
import { env } from "cloudflare:workers";

const read = async () => Number((await env.COUNTER.get("count")) ?? 0);

export const load: ServerLoad = async () => ({ count: await read() });

export const actions: Actions = {
  default: async () => {
    await env.COUNTER.put("count", String((await read()) + 1));
  },
};
