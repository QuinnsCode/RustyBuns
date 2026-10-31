// Pages' SPA fallback is a `_redirects` line, `/* /index.html 200`. Workers' asset layer rejects that exact line as a
// redirect loop (BadRequest on upload), and has its own way to say it: `notFoundHandling: "single-page-application"`.
// The generated stack spreads this into `assets`, so a Pages app converted by `init` deploys without editing its files.
// No node: imports: the stack is type-checked beside this file without @types/node, as the stack itself is (`declare const process`).
declare const require: (id: string) => any;

const CATCH_ALL = /^\s*\/\*\s+\/index\.html\s+200\s*$/;

/** What to pass Alchemy's assets for the `_redirects` in `dir`: its text without the fallback, and SPA mode if it had one. */
export function spaFallback(dir: string): { redirects?: string; notFoundHandling?: "single-page-application" } {
  const fs = require("node:fs");
  const file = `${dir}/_redirects`;
  if (!fs.existsSync(file)) return {};
  const lines: string[] = String(fs.readFileSync(file, "utf8")).split("\n");
  const kept = lines.filter((l: string) => !CATCH_ALL.test(l));
  if (kept.length === lines.length) return {};
  return { redirects: kept.join("\n"), notFoundHandling: "single-page-application" };
}
