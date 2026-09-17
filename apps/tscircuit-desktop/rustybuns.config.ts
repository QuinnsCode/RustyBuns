import { defineConfig } from "@rustybuns/cli/config";

// Desktop-only app: no Cloudflare. `vite build` makes the UI, desktop/host.ts
// is the backend, and the Rust crate ships inside the binary.
export default defineConfig({
  name: "tscircuit-desktop",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: false,
      host: "desktop/host.ts",
      native: ["tsci_analysis"],
      // tscircuit loads 3D models and fonts from CDNs that send no CORP header.
      headers: { "Cross-Origin-Embedder-Policy": "credentialless" },
      window: "app",
      dataDir: "~/.tscircuit-desktop",
      targets: ["linux-x64"],
    },
  },
});
