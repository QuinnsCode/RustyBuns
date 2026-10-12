// TanStack Start's production server and static files, by how the app builds it. The desktop
// mounts the server's default export ({ fetch }) like any Worker.
/** Where a TanStack Start build puts its server ({ fetch }) and its static files, by Nitro setup. */
export function startLayout(viteConfig: string): { builtMain: string; assets: string; env: string; warn?: string } {
  const nitro = /\bnitro(?:V2Plugin)?\s*\(/.test(viteConfig);
  const preset = viteConfig.match(/\bpreset\s*:\s*["']([\w-]+)["']/)?.[1];
  // No Nitro: Start's own Vite build, <outDir>/server/server.js exports { fetch } (a custom server
  // entry is found at build time: the one script in that folder).
  const out = (viteConfig.match(/\boutDir\s*:\s*["'](?:\.\/)?([^"']+?)\/?["']/)?.[1]) ?? "dist";
  if (!nitro) return { builtMain: `${out}/server/server.js`, assets: `${out}/client`, env: "" };
  // Vercel's web handler is export default { fetch }, beside the static files it serves.
  if (preset === "vercel") return { builtMain: ".vercel/output/functions/__server.func/index.mjs", assets: ".vercel/output/static", env: "" };
  // No preset: NITRO_PRESET picks "standard", whose .output/server/index.mjs exports { fetch }.
  // (A preset in the config wins over the variable, so it only steers apps that set none.)
  if (!preset) return { builtMain: ".output/server/index.mjs", assets: ".output/public", env: "NITRO_PRESET=standard " };
  if (/^cloudflare/.test(preset) || preset === "standard") return { builtMain: ".output/server/index.mjs", assets: ".output/public", env: "" };
  return { builtMain: ".output/server/index.mjs", assets: ".output/public", env: "",
    warn: `its Nitro preset "${preset}" starts a server of its own, which the desktop can't mount. Remove the preset (or set it per deploy, with NITRO_PRESET) and it builds one that can.` };
}
