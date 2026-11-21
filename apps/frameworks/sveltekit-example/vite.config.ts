// SvelteKit 3 takes its config here (no svelte.config.js): the Cloudflare adapter builds the
// Worker and its assets into .svelte-kit/cloudflare, which wrangler.jsonc points at.
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });
