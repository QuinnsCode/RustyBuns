// Where the health bar plugs into the release: the server's PR list gains checkTally (built from checks/tally.ts
// into rb-checks.js), and the card's checks dot (km[e.checks] in assets/ask-*.js) gives way to the bar when there is one.

/** server/github.js */
export function checkTallyServer(js: string) {
  const checks = "                checks: checksOf(p.statusCheckRollup),\n";
  return once(js, "github.js", `${checks}                body:`, `${checks}                checkTally: __rbTally(p.statusCheckRollup),\n                body:`);
}

export const SERVER_IMPORT = "import { tally as __rbTally } from './rb-checks.js';\n";

/** The client bundle's PR card, minified. */
export function checksBarClient(js: string) {
  return once(js, "assets/ask-*.js", "`by ${e.author}`,e.reviewDecision===`CHANGES_REQUESTED`?`🛠 changes requested`:``,km[e.checks],",
    "`by ${e.author}`,e.reviewDecision===`CHANGES_REQUESTED`?`🛠 changes requested`:``,globalThis.__rbChecksBar?.(e)??km[e.checks],");
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
