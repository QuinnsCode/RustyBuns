// Fails when a tracked file still holds git conflict markers: a line starting with `<<<<<<< `,
// `>>>>>>> `, or exactly `=======`. #884 merged features.json with them in, and since no test
// parsed that file, CI passed. typecheck.yml runs this on every PR.
//
// git grep finds the candidates (-I skips binary files). In markdown, lines inside fenced code
// are skipped, so a doc can show what a conflict looks like.
//
//   bun scripts/conflict-markers.ts

/** Files that hold markers on purpose. Add one here only when it's about merging. */
export const ALLOW = new Set([
  "apps/codesplitter/src/conflict-agent.ts",
  "apps/codesplitter/test/conflicts.test.ts",
]);

const MARKER = /^(<{7} |>{7} |={7}$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The 1-based line numbers of conflict markers in this file's text. */
export function markers(path: string, text: string): number[] {
  const md = /\.(md|mdx|markdown)$/i.test(path);
  let fence: string | null = null;
  const out: number[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (md) {
      const f = line.match(FENCE)?.[1];
      if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) {
        fence = fence ? null : f;
        return;
      }
      if (fence) return;
    }
    if (MARKER.test(line)) out.push(i + 1);
  });
  return out;
}

/** Every marker in the tracked files under `cwd`, as `path:line` strings. */
export async function scan(cwd = "."): Promise<string[]> {
  const res = await Bun.$`git grep -lI -E ${"^(<{7} |>{7} |={7}\r?$)"}`.cwd(cwd).quiet().nothrow();
  if (res.exitCode > 1) throw new Error(`git grep failed: ${res.stderr.toString()}`);
  const files = res.stdout.toString().split("\n").filter((f) => f && !ALLOW.has(f));
  const out: string[] = [];
  for (const f of files) {
    for (const n of markers(f, await Bun.file(`${cwd}/${f}`).text())) out.push(`${f}:${n}`);
  }
  return out;
}

if (import.meta.main) {
  const found = await scan();
  if (found.length) {
    console.error(`Conflict markers left in:\n${found.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("No conflict markers.");
}
