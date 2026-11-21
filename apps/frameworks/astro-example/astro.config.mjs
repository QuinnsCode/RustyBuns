// As Astro's Cloudflare guide writes it: server output through the Cloudflare adapter.
// `passthrough` images mean the adapter's /_image needs no IMAGES binding.
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
});
