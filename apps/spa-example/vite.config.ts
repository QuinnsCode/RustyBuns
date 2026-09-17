import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";
export default defineConfig({ plugins: [cloudflare(), redwood()], resolve: { alias: { "@": resolve(__dirname, "src") } } });
