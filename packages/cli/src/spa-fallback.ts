// Pages' SPA fallback is a `_redirects` line, `/* /index.html 200`. Workers' asset layer rejects that exact line as a
// redirect loop (BadRequest on upload), and has its own way to say it: `notFoundHandling: "single-page-application"`.
// The generated stack spreads this into `assets`, so a Pages app converted by `init` deploys without editing its files.
// Alchemy loads the stack under Node, and the stack is type-checked without @types/node: so no `node:` import and no
// `require`, but `process.getBuiltinModule` (Node 22.3+, Bun), declared here the way the stack declares `process`.
declare const process: { getBuiltinModule(id: string): any };

const CATCH_ALL = /^\s*\/\*\s+\/index\.html\s+200\s*$/;

/** What to pass Alchemy's assets for the `_redirects` in `dir`: its text without the fallback, and SPA mode if it had one. */
export function spaFallback(dir: string): { redirects?: string; notFoundHandling?: "single-page-application" } {
  const fs = process.getBuiltinModule("node:fs");
  const file = `${dir}/_redirects`;
  if (!fs.existsSync(file)) return {};
  const lines: string[] = String(fs.readFileSync(file, "utf8")).split("\n");
  const kept = lines.filter((l: string) => !CATCH_ALL.test(l));
  if (kept.length === lines.length) return {};
  return { redirects: kept.join("\n"), notFoundHandling: "single-page-application" };
}
