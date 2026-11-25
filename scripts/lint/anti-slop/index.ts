// Five rules from dmmulroy/anti-slop (MIT, LICENSE here), vendored at 63dbb09 (2026-11-20) and ours to change.
// Picked for this repo: each one flags a cast or a copy, not a style. The rest of that set fights our
// guards (`no-runtime-typeof`, `no-unknown-parameters`: a guard takes `unknown` and asks `typeof`) or is
// formatting (`require-readable-spacing`). Wired up in .oxlintrc.json; run by scripts/lint.ts.
// Our changes: `no-reflect-get` skips the three-argument form, which is how a Proxy `get` trap forwards.
// .oxlintrc.json turns the cast and Reflect rules off in tests, where a fake stands in for a real type on purpose.
import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noReduceAccumulatorCopyRule } from "./rules/no-reduce-accumulator-copy.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
    "no-widen-then-assert": noWidenThenAssertRule,
  },
});
