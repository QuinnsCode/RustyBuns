// bun borg.ts <url> [--token <t>]: run slim borg against a running copy and print the grid.
// A deploy needs only its URL. A desktop host needs its token (RB_TOKEN when you started it).
import { formatResults, runBorg } from "./src/suite.ts";

const [url, ...rest] = process.argv.slice(2);
if (!url) { console.error("usage: bun borg.ts <url> [--token <t>]"); process.exit(2); }
const i = rest.indexOf("--token");
const token = i >= 0 ? rest[i + 1] : undefined;
const base = url.replace(/\/$/, "");
const headers = token ? { cookie: `rb_token_${new URL(base).port}=${token}` } : undefined;

const results = await runBorg({ url: base, headers });
console.log(`slim borg against ${base}\n${formatResults(results)}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
