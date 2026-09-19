// Cloudflare shell: static SPA only for now. The host lanes (Rust, TS-on-host)
// are desktop features; on the edge the page runs the browser lane.
export default {
  fetch(req: Request, env: { ASSETS: { fetch(r: Request): Promise<Response> } }) { return env.ASSETS.fetch(req); },
};
