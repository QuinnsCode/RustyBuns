import { defineConfig } from "@rustybuns/cli/config";

// The page runs a level on its own. "Host" on the battle menu runs a battle in this world
// (src/net/world.ts) and opens it to the LAN; friends running their own copy join it.
export default defineConfig({
  name: "git-recon",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: "src/net/world.ts",
      worldPath: "/ws",
      host: "src/host/host.ts",
      // Closed until the page opens it with POST /__rb/host. A battle holds 32: the host and 31 guests.
      guests: { max: 31 },
      window: "app",
    },
  },
});
