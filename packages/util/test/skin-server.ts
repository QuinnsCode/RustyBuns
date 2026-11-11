// Serves skin-page.ts for skin.test.ts and scripts/skin-shots.ts. With ?game=<app> the page also wears that game's own
// stylesheet (its :root tokens: Two Fronts' plate and stencil, Mythic's paper and book face, Skate's paper and ink) and its
// public files (fonts, plates), so the eqosys surfaces resolve the game's `var(--...)` values the way they do in the game.
import { join } from "node:path";

const apps = join(import.meta.dir, "../../../apps");
export const GAMES: Record<string, { css: string; head?: string }> = {
  "two-fronts": { css: "two-fronts/src/styles.css", head: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Stencil+One&family=Share+Tech+Mono&display=swap">` },
  "mythic-masters": { css: "mythic-masters/src/tome.css" },
  "skate-tech-park": { css: "skate-tech-park/src/styles.css" },
};

/** The page on a free port; `fonts` adds a game's web-font links (shots want them, tests stay off the network). */
export async function skinServer(o: { fonts?: boolean } = {}) {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "skin-page.ts")], target: "browser" });
  const script = await built.outputs[0]!.text();
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => {
    const url = new URL(req.url), game = GAMES[url.searchParams.get("game") ?? ""];
    if (url.pathname === "/page.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/") return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${game ? `${o.fonts ? game.head ?? "" : ""}<link rel="stylesheet" href="/game.css?game=${url.searchParams.get("game")}">` : ""}<body><script type="module" src="/page.js"></script>`, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/game.css" && game) return new Response(Bun.file(join(apps, game.css)), { headers: { "content-type": "text/css" } });
    // A game's fonts and plates, from whichever game has the file.
    for (const g of Object.values(GAMES)) {
      const f = Bun.file(join(apps, g.css.split("/")[0]!, "public", url.pathname));
      if (!url.pathname.includes("..") && await f.exists()) return new Response(f);
    }
    return new Response("", { status: 404 });
  } });
}
