// The Cloudflare entry `npm run qwik add cloudflare-pages` writes: Qwik City's request handler as
// a `fetch(request, env, ctx)`. `platform.env` in loaders and actions is the Worker's env, so
// `platform.env.COUNTER` is the KV binding. Nothing here knows about Rusty Buns.
import { createQwikCity, type PlatformCloudflarePages } from "@builder.io/qwik-city/middleware/cloudflare-pages";
import qwikCityPlan from "@qwik-city-plan";
import { manifest } from "@qwik-client-manifest";
import render from "./entry.ssr";

declare global {
  interface QwikCityPlatform extends PlatformCloudflarePages {
    // The one binding this app reads. (@cloudflare/workers-types has the full set.)
    env: { COUNTER: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> } };
  }
}

const fetch = createQwikCity({ render, qwikCityPlan, manifest });

export { fetch };
