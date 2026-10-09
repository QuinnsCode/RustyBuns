import { defineConfig } from "@rustybuns/cli/config";

// A desktop game: the page runs single player itself; "Host a game" opens the
// world to the LAN, and friends running their own copy join it. The box is the
// same host on Railway, played like the edge: room codes and quick play.
export default defineConfig({
  name: "park-hide-seek",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: "packages/desktop/world.ts",
      worldPath: "/ws",
      host: "packages/desktop/host.ts",
      // Closed until the page opens it with POST /__rb/host.
      guests: { max: 7 },
      window: "app",
    },
    // `rustybuns deploy --stage railway-test` keeps the shared test copy current.
    box: { provider: "railway" },
  },
});
