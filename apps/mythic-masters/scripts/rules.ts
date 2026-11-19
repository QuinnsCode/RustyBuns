// Writes docs/RULES.md from the rules sheet (src/rules.ts), where each rule's numbers are read from the code's own
// constants. Run it after a constant or a rule's words change; the test (test/rules.test.ts) fails while the page is stale.
//
//   bun run rules            write docs/RULES.md
//   bun run rules --check    exit 1 when the page is not what the sheet says (writes nothing)
//   bun run rules --print    the page on stdout
import { join } from "node:path";
import { rulesMd } from "../src/rules.ts";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const file = join(import.meta.dir, "../docs/RULES.md"), want = rulesMd(), args = process.argv.slice(2);
if (args.includes("--print")) console.log(want);
else if (args.includes("--check")) {
  const have = await Bun.file(file).text().catch(() => "");
  if (have !== want) { console.error("docs/RULES.md is stale: run `bun run rules`"); process.exit(1); }
  console.log("docs/RULES.md matches the sheet");
} else { await Bun.write(file, want); console.log(`wrote docs/RULES.md (${want.split("\n").length} lines)`); }
