// Secret names an app reads but no file declares. A Worker's secrets usually live in Cloudflare
// (`wrangler secret put`), so a fresh clone has no .dev.vars to read them from, and the host then
// binds none: an app that needs one fails at boot ("No secret key provided for session store").
//   env.O365_OAUTH_CLIENT_SECRET in src/, not a var or binding  ->  an optional secret
//   rwsdk's session store (rwsdk/auth) reads env.AUTH_SECRET_KEY  ->  a required one
// Names only: values come from .dev.vars, or the deploying shell, as for any secret.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
// tests and their fixtures read their own env (E2E_PASSWORD), not the Worker's
const SKIP_DIR = /^(?:node_modules|dist|build|\.\w.*|__tests__|__mocks__|test|tests|e2e|fixtures)$/;
const SKIP_FILE = /\.(?:test|spec|workerd\.test)\.[cm]?[jt]sx?$|\.d\.ts$/;
// read through env but set by a build or the platform, never a secret
const NOT_SECRET = /^(?:VITE_|NODE_ENV$|CI$|PORT$|HOST(?:NAME)?$|HOME$|PATH$|PWD$|TZ$|MODE$|DEV$|PROD$|SSR$|BASE_URL$)/;

export function codeSecrets(srcDir: string, known: Set<string>, framework?: string): { required: string[]; optional: string[] } {
  const seen = new Set<string>();
  let rwsdkAuth = false;
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(join(dir, e.name)); continue; }
      if (!SOURCE.test(e.name) || SKIP_FILE.test(e.name)) continue;
      const src = readFileSync(join(dir, e.name), "utf8");
      for (const m of src.matchAll(/\benv(?:\.([A-Z][A-Z0-9_]*)\b|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g)) seen.add((m[1] ?? m[2])!);
      if (framework === "rwsdk" && /from\s+["']rwsdk\/auth["']/.test(src)) rwsdkAuth = true;
    }
  };
  walk(srcDir);
  const required = rwsdkAuth && !known.has("AUTH_SECRET_KEY") ? ["AUTH_SECRET_KEY"] : [];
  const optional = [...seen].filter((n) => n.length > 1 && !known.has(n) && !required.includes(n) && !NOT_SECRET.test(n)).sort();
  return { required, optional };
}

/** Every binding, var and secret name a wrangler config declares, including the kinds init can't
 *  carry over yet (workflows, vectorize, worker_loaders) and each env.* block's: none is a secret. */
export function wranglerNames(w: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if ((k === "binding" || k === "name") && typeof x === "string") out.push(x);
      else if (k === "vars" && x && typeof x === "object") out.push(...Object.keys(x));
      else if (k === "secrets" && Array.isArray((x as { required?: unknown })?.required)) out.push(...(x as { required: string[] }).required);
      walk(x);
    }
  };
  walk(w);
  return out;
}
