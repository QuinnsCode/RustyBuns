// workerd's globalThis.Cloudflare, which a Worker built with nodejs_compat (unenv's Cloudflare
// preset) reads while it loads: `globalThis.Cloudflare.compatibilityFlags.<flag>`. The worker-mode
// host imports this before the Worker. Only the flags the app lists are true; flags workerd would
// imply from the compatibility date read as unset, which keeps unenv on its polyfills.
declare const RB_COMPAT_FLAGS: string | undefined;
const flags = typeof RB_COMPAT_FLAGS === "string" && RB_COMPAT_FLAGS ? RB_COMPAT_FLAGS.split(",") : [];
const g = globalThis as { Cloudflare?: { compatibilityFlags: Record<string, boolean> } };
g.Cloudflare ??= { compatibilityFlags: Object.fromEntries(flags.map((f) => [f, true])) };
export {};
