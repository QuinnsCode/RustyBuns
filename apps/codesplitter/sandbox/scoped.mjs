// Only the tests for some files (#990): a merge's answer runs the tests for the file it settled,
// not the repo's whole test script. Shared by the desktop's tester (src/deps.ts) and the
// container's (server.mjs), so both pick the same command. Plain Node, no dependencies.

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const stem = (path) => path.split("/").pop().replace(TEST_FILE, "").replace(/\.[^.]+$/, "");

/**
 * The command that runs only the tests for `only`, or null to run the test script as it is.
 * It's scoped only where the script is one runner run straight (`bun test`, `vitest`, `jest`,
 * with flags and nothing else): vitest and jest find the tests that import those files
 * themselves; for bun, it's the tracked test files (`tracked`, git ls-files) named after one of
 * them, or one of them that's a test, and none means the whole script.
 */
export function scopedTest(script, only, tracked) {
  if (!only?.length || !/^[\w@./=:,+-]+( +[\w@./=:,+-]+)*$/.test(script?.trim() ?? "")) return null;
  const [bin, ...rest] = script.trim().split(/ +/);
  if (bin === "bun" && rest[0] === "test") {
    const stems = new Set(only.map(stem));
    const tests = tracked.filter((p) => TEST_FILE.test(p) && (only.includes(p) || stems.has(stem(p))));
    return tests.length ? ["bun", ...rest, ...tests.map((p) => `./${p}`)] : null;
  }
  if (bin === "vitest") return ["node_modules/.bin/vitest", "related", "--run", ...(rest[0] === "run" ? rest.slice(1) : rest), ...only];
  if (bin === "jest") return ["node_modules/.bin/jest", ...rest, "--passWithNoTests", "--findRelatedTests", ...only];
  return null;
}
