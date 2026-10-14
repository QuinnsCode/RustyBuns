// bun story.ts <url> [--token <t>]: run the keep-the-database checks against a deploy or a host you started.
import { formatResults, runStory } from "./src/suite.ts";

const [url, flag, token] = process.argv.slice(2);
if (!url) { console.error("usage: bun story.ts <url> [--token <t>]"); process.exit(2); }
const headers = flag === "--token" && token ? { cookie: `rb_token_${new URL(url).port}=${token}` } : undefined;
const results = await runStory({ url, headers });
console.log(formatResults(results));
process.exit(results.every((r) => r.ok) ? 0 : 1);
