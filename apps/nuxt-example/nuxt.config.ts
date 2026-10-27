// A Nuxt app as Nuxt's own Cloudflare docs set it up: Nitro's cloudflare-module preset builds
// the Worker into .output/server/index.mjs and the client into .output/public. Nothing here
// knows about Rusty Buns.
export default defineNuxtConfig({
  compatibilityDate: "2026-09-01",
  nitro: { preset: "cloudflare-module" },
});
