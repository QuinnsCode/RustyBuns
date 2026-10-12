// bun borg.ts <url> [--token <t>] [--limits]: run slim borg against a running copy and print the grid.
// A deploy needs only its URL. A desktop host needs its token (RB_TOKEN when you started it).
// --limits also goes over each edge limit and says which ones the target refused.
import { formatResults, LIMITS, runBorg } from "./src/suite.ts";

const [url, ...rest] = process.argv.slice(2);
if (!url) { console.error("usage: bun borg.ts <url> [--token <t>] [--limits]"); process.exit(2); }
const i = rest.indexOf("--token");
const token = i >= 0 ? rest[i + 1] : undefined;
const base = url.replace(/\/$/, "");
const headers = token ? { cookie: `rb_token_${new URL(base).port}=${token}` } : undefined;

const results = await runBorg({ url: base, headers });
console.log(`slim borg against ${base}\n${formatResults(results)}`);
if (rest.includes("--limits")) console.log(`\nlimits (✓ refused, as the edge does; ✗ accepted, looser)\n${formatResults(await runBorg({ url: base, headers }, LIMITS))}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
