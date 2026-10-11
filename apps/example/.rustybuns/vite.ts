// GENERATED vite plugin: the desktop client's view of the server boundary.
import type { Plugin } from "vite";
const stubs: Record<string, string> = {
  "rwsdk/worker": "/Users/ryanquinn/agent-office/QuinnsCode/RustyBuns/.agent-office/worktrees/sprocket-7745/apps/example/.rustybuns/stubs/rwsdk_worker.ts",
  "cloudflare:workers": "/Users/ryanquinn/agent-office/QuinnsCode/RustyBuns/.agent-office/worktrees/sprocket-7745/apps/example/.rustybuns/stubs/cloudflare_workers.ts"
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
