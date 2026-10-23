// Fake secrets so an app boots logged-out, and the removal of committed real ones. Used by `rustybuns smoke`
// and scripts/trial-github.ts: neither may ever use a real credential.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** A plausible fake for a secret, by its name. Never real: enough for an app to boot logged-out. */
export function fakeSecret(name: string): string | undefined {
  const hex = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("hex");
  if (/^(NODE_ENV|PORT|HOST|HOSTNAME|CI|HOME|PATH|TZ|PWD)$|^CLOUDFLARE_/.test(name)) return undefined;
  // Clerk checks the format: pk_<env>_ + base64("<frontend api host>$")
  if (/CLERK.*PUBLISHABLE|PUBLISHABLE.*CLERK/.test(name)) return `pk_test_${Buffer.from("rustybuns-trial.clerk.accounts.dev$").toString("base64")}`;
  if (/CLERK.*SECRET/.test(name)) return `sk_test_${hex(20)}`;
  if (/STRIPE.*PUBLISHABLE/.test(name)) return `pk_test_${hex(24)}`;
  if (/STRIPE.*SECRET/.test(name)) return `sk_test_${hex(24)}`;
  // addresses go nowhere: port 9 (discard) refuses at once, and the sandbox has no network anyway
  if (/(DATABASE|DB|POSTGRES|PG).*(URL|URI)|^DATABASE_URL$/.test(name)) return "postgres://trial:trial@127.0.0.1:9/trial";
  if (/(MYSQL).*(URL|URI)/.test(name)) return "mysql://trial:trial@127.0.0.1:9/trial";
  if (/(REDIS|KV).*(URL|URI)/.test(name)) return "redis://127.0.0.1:9";
  if (/(URL|URI|ENDPOINT|ORIGIN|BASE)$/.test(name)) return "http://127.0.0.1:9";
  if (/SECRET|KEY|TOKEN|PASSWORD|PASS$|SALT|PRIVATE|SIGNING/.test(name)) return hex(32);
  if (/EMAIL|FROM$/.test(name)) return "trial@example.invalid";
  if (/^VITE_|^PUBLIC_|^NEXT_PUBLIC_/.test(name)) return "rustybuns-trial";
  return undefined;
}

/** The secret names an app declares (.env.example and friends) or reads (process.env.X, env.X) in its own code. */
export function declaredSecrets(dir: string): string[] {
  const names = new Set<string>();
  const examples = /^\.(env|dev\.vars)(\..+)?\.(example|sample|template)$|^\.env\.(example|sample|template)$/;
  const code = /\.(m?[jt]sx?)$/;
  let files = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || files > 2000) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (/^(node_modules|\.git|dist|build|\.output|\.vercel|\.wrangler|\.rustybuns)$/.test(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (examples.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/gm)) names.add(m[1]!);
      else if (code.test(e.name) && files++ < 2000) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b(?:process\.env|import\.meta\.env|env)\.([A-Z][A-Z0-9_]{2,})\b/g)) names.add(m[1]!);
        for (const m of src.matchAll(/\b(?:process\.env|env)\[["']([A-Z][A-Z0-9_]{2,})["']\]/g)) names.add(m[1]!);
      }
    }
  };
  walk(dir, 0);
  // SDKs that read their own variables, which the app's code never names
  const pkg = (() => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { return {}; } })();
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const [dep, vars] of Object.entries(IMPLICIT)) if (deps.some((d) => d === dep || d.startsWith(dep + "/"))) vars.forEach((v) => names.add(v));
  // `import.meta.env.VITE_${key}` reads a family of names, not one called VITE_
  return [...names].filter((n) => !n.endsWith("_")).sort();
}

/** Variables an SDK reads by itself when present. */
const IMPLICIT: Record<string, string[]> = {
  "@clerk": ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "VITE_CLERK_PUBLISHABLE_KEY"],
  "better-auth": ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"],
  "next-auth": ["AUTH_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL"], "@auth": ["AUTH_SECRET", "AUTH_URL"],
  "convex": ["CONVEX_URL", "VITE_CONVEX_URL"], "@convex-dev": ["CONVEX_URL", "VITE_CONVEX_URL"],
  "@supabase": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
  "stripe": ["STRIPE_SECRET_KEY"], "resend": ["RESEND_API_KEY"], "openai": ["OPENAI_API_KEY"],
  "@anthropic-ai": ["ANTHROPIC_API_KEY"], "@neondatabase": ["DATABASE_URL"], "@prisma/client": ["DATABASE_URL"], "postgres": ["DATABASE_URL"],
};

/** .env, .env.production, .dev.vars and the like anywhere in a clone (not .env.example), deleted; returns their paths. */
export function removeCommittedSecrets(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^\.(env|dev\.vars)(\..+)?$/.test(e.name) && !/\.(example|sample|template|schema|defaults)$/.test(e.name)) { rmSync(p); out.push(p.slice(root.length + 1)); }
    }
  };
  walk(root);
  return out;
}
