// Mervin, codeSplitter's merge engine (lines.ts, merge-plan.ts), as the UI and API name him.
// The corpus is what scripts/mervin-corpus.ts measured on git/git (docs/mervin.md): of the text files git's own
// merge gave up on, how many Mervin settled to what the person committed (or the same lines reordered), how many
// he handed back as cards, and how many he settled to other text. Imports nothing.

export const MERVIN = {
  name: "Mervin",
  does: "codeSplitter's merge engine: merges by line id, settles what git would conflict on, and orders clashing branches into waves",
  corpus: {
    repo: "git/git", measured: "2026-10-13", files: 467,
    settled: 227, // 200 exactly what landed, 27 the same lines in another order or bar indentation
    asked: 181, // handed back as cards
    other: 59, // settled clean to other text: the number to drive to 0
    // Line cards from the 2026-10-13 board of this repo's open PRs (#1523): each is a case to find the rule that settles it.
    cards: [
      { file: "apps/codesplitter/src/shares.ts", line: 10, pr: 1467, after: 1456, rule: null },
      { file: "apps/codesplitter/src/deploy.ts", line: 197, pr: 1501, rule: null },
    ] as { file: string; line: number; pr: number; after?: number; rule: string | null }[],
  },
};
