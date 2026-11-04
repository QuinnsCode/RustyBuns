// The dashed spelling, super-splat-spy-shot.notryanquinn.workers.dev: a workers.dev name belongs to one Worker,
// so this one only sends players to the game's own name (wrangler.alias.jsonc), path and query kept.
export const HOME = "https://supersplatspyshot.notryanquinn.workers.dev";

export default {
  fetch(req: Request): Response {
    const url = new URL(req.url);
    return Response.redirect(`${HOME}${url.pathname}${url.search}`, 301);
  },
};
