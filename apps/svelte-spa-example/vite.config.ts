// The "use server" actions become calls to the desktop host through the generated boundary plugin;
// without it the action module (node:fs, node:os) is bundled into the page and it throws on load.
// .rustybuns/vite.ts comes from `rustybuns boundary`, which every build runs first.
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { rustybuns } from "./.rustybuns/vite.ts";

export default defineConfig({ plugins: [rustybuns(), svelte()] });
