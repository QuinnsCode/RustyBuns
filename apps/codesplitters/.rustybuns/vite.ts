// GENERATED vite plugin: the desktop client's view of the server boundary.
import type { Plugin } from "vite";
const stubs: Record<string, string> = {
  "better-auth/crypto": "/Users/ryanquinn/Documents/projects/RustyBuns/apps/codesplitters/.rustybuns/stubs/better_auth_crypto.ts",
  "better-auth": "/Users/ryanquinn/Documents/projects/RustyBuns/apps/codesplitters/.rustybuns/stubs/better_auth.ts",
  "rwsdk/worker": "/Users/ryanquinn/Documents/projects/RustyBuns/apps/codesplitters/.rustybuns/stubs/rwsdk_worker.ts",
  "cloudflare:workers": "/Users/ryanquinn/Documents/projects/RustyBuns/apps/codesplitters/.rustybuns/stubs/cloudflare_workers.ts"
};
const actions: Record<string, string> = {};
export function rustybuns(): Plugin {
  return {
    name: "rustybuns-boundary",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (stubs[source]) return stubs[source];
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      const id = r?.id.replace(/\\/g, "/");
      if (id && actions[id]) return actions[id];
      return r;
    },
  };
}
