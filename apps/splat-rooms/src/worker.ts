// Cloudflare shell. Scenes live on the user's disk, so the edge build is the
// viewer with nothing to view; the desktop app is the real target here.
export default {
  fetch(req: Request, env: { ASSETS: { fetch(r: Request): Promise<Response> } }) { return env.ASSETS.fetch(req); },
};
