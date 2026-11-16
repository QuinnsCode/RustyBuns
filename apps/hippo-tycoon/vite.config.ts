// Browser build: `bun run dev` for hot reload, and the Cloudflare assets (dist/client).
// installable: Add to Home Screen gives a full-screen icon, and solo and couch play with no signal (#4687).
import { defineConfig } from "vite";
import { installable } from "@rustybuns/cli/installable";

const BG = [0x14, 0x0d, 0x09] as const, HIPPO = [0x9c, 0x82, 0xab] as const, GOLD = [0xf2, 0xc2, 0x30] as const;

/** The favicon's hippo, full size: a purple head with a gold grin on dark ground. */
function icon(u: number, v: number) {
  const x = u * 16, y = v * 16;
  if (Math.hypot(x - 8, y - 9) > 5) return BG;
  return Math.abs(y - 9) < 1 && x > 5 && x < 11 ? GOLD : HIPPO;
}

export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { target: "esnext", sourcemap: false, chunkSizeWarningLimit: 1500 },
  plugins: [installable({ name: "Hippo Tycoon", background: "#08100d", theme: "#140d09", icon })],
});
