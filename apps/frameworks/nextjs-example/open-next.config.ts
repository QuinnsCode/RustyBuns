// OpenNext's Cloudflare adapter, as its own docs set it up: `opennextjs-cloudflare build` runs
// `next build`, then writes the Worker to .open-next/worker.js and the static files to
// .open-next/assets. Nothing here knows about Rusty Buns.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
