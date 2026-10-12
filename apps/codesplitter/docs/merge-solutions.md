# Merge solutions: let agents crawl the same files

Agents will keep editing the same files. This doc is about settling those overlaps with rules that
give the same answer every time, so fewer conflicts get handed to an AI to guess at. It measures
the two open PRs that clash with main, sorts every git hunk by why it clashed, and tries each
proposed resolver on it. Live editing on main (leases, queues, intents) is covered in
[line-locks.md](line-locks.md). This doc covers branches meeting at merge time.

**Result.** git leaves 29 conflict hunks between main and #893 + #886. codeSplitter's merge by line
id already settles 16. Three small fixes to it, plus a list-aware union inside a stretch both sides
reshaped, settle 25. That leaves 3 real rewrites for an AI whose answer must pass the build, and 1
hunk that only exists because main has committed conflict markers in it (fixed in this PR). The
first estimate was "~25 of 30 need a person". The measured number is 4, and none of them needs a person once main is fixed.

## 1. The measurement

Reproduced on 2026-10-12 against main `3826cb7`. Neither PR had merged.

```sh
git -c merge.conflictStyle=diff3 merge-tree --write-tree origin/main origin/office/sprocket-2720   # #893, base d7ef133
git -c merge.conflictStyle=diff3 merge-tree --write-tree origin/main origin/office/sprocket-db4e   # #886, base 9c6885a
```

That prints 30 `<<<<<<<` markers. The 30th is not a separate hunk: main's own `src/features.json` already held
`<<<<<<< HEAD … >>>>>>> origin/main`, committed by the squash merge of #884, so git nested it inside #886's hunk. That leaves **29 hunks: 10 in #893, 19 in #886.**

Each hunk was then run three ways:

- through codeSplitter's real `merge()` (`src/lines.ts`), on docs built from the three file versions with `fromText` and `diffToOps`
- through `mergeWords(base, main, branch, both)` over the whole hunk
- through a plain token-level diff3

The scripts were throwaway and stayed in the scratchpad.

### Buckets

| Bucket | What it looks like | #893 | #886 | All |
|---|---|---|---|---|
| **A. Both added at one spot** | Base empty. Each side put its new block after the same "newest sibling": the last test of a describe, the last paragraph of a header comment, the last row of a form | 1 | 6 | 7 |
| **B. Adjacent, different lines** | Main changed line N, the branch changed N+1. git flags it, but a merge by line id doesn't | 3 | 0 | 3 |
| **C. One-liner holding a list or paragraph** | Both sides added items to one long line: an import list, `DEFAULTS`, `interface Report {…}`, a body sketch, a SQL `SET … ?` with its `.bind(…)`, a CSS rule line, a README or REFERENCE paragraph | 5 | 10 | 15 |
| **D. Real rewrite of the same code** | One side restructured code the other side edited | 1 | 2 | 3 |
| **E. Broken input** | Main already had conflict markers in the file | 0 | 1 | 1 |

Corrections to the first pass:

- The deps routes in `src/api.ts` and the `deps.ts` header are **C, not B**. Both sides edited the same `{…, held, preview}` line: main appended `digs`, and the branch put `rank` before `preview`.
- No hunk sits at the end of a file. But most A hunks are appends to the end of a *section*. Each agent anchors its block after the most recently added sibling, which is the same spot for two agents working at once.
- 2 of the C hunks are true end-of-list appends: both sides added `, x` after the last item of the save body in `client.html` and of the `return {…}` in `deps.ts`. 4 more are one side appending and the other inserting mid-list.

### Each hunk, and what settles it

"Today" is codeSplitter's merge as it is on main. L2 and L3 are the resolver levels in §3.

| PR | Hunk | Bucket | Today | Settled by |
|---|---|---|---|---|
| #893 | README.md "The vein" bullet | C paragraph | ✗ the rename guard trips on "a", "it" | L2 prose guard |
| #893 | client.html:288 CSS rule line, plus rules added under it | C rules | ✗ reshaped stretch | L3 |
| #893 | client.html:2048 doc comment vs. `tagMarks` added above it | B | ✓ | today |
| #893 | client.html:2126 `drawGraph(graph)`: the branch removed it, main hung the pulse code under it | D | ✗ | AI + build check |
| #893 | client.html:2211 `commitGraph` comment vs. signature | B | ✓ | today |
| #893 | client.html:2240 `<g class=…>`: `tip` and `sel` added at one spot, plus `data-hash`→`data-h` | C attr list | ✗ reshaped | L3, output checked correct |
| #893 | client.html:2252 graph head template (3 lines) | C | ✓ word merge | today |
| #893 | client.test.ts:52 describe header vs. destructuring | B | ✓ | today |
| #893 | mirror.test.ts:559 new tests after #875's | A | ✓ | today |
| #893 | worker.ts:56 `import { … } from "./mirror.ts"` | C import | ✗ `diffToOps` paired main's new `beamRoutes` line with the old import | L2 similarity pairing |
| #886 | README.md doctor bullet | C paragraph | ✓ | today |
| #886 | REFERENCE.md doctor bullet (6 KB, one line) | C paragraph | ✓ | today |
| #886 | api.ts:264 `PUT …/deps` body and `does` | C list | ✓ | today |
| #886 | client.html:3314 settings rows before Save | A | ✓ | today |
| #886 | client.html:3326 updates list: main extracted `depUpdate()`, the branch edited the inline template | D | ✗ | AI + build check |
| #886 | client.html:3356 digs UI vs. rank UI | A | ✓ | today |
| #886 | client.html:3407 `{ …, held: f.held.value }` + `digs` / `rank` | C end-of-list | ✗ suggestion only | L3 |
| #886 | deps.test.ts:3 import list | C import | ✓ | today |
| #886 | deps.test.ts:393 new tests | A | ✗ false "doubled": `const pkg = JSON.parse(…)` sits in both new tests | L2 doubled rule |
| #886 | deps.ts:57 header paragraph | A | ✓ | today |
| #886 | deps.ts:91 header route list | C list | ✓ | today |
| #886 | deps.ts:137 one-line `DEFAULTS`, plus declarations added under it | C object | ✗ reshaped | L3 |
| #886 | deps.ts:176 one-line `interface Report`, which the branch also reflowed to 5 lines | C type | ✗ reshaped | L3 |
| #886 | deps.ts:220 `Registry`: main extracted `interface Meta`, the branch added `peers?` inline | D | ✗ | AI + build check |
| #886 | deps.ts:270 registry fetch: the type cast and `return {…}`, both appended | C end-of-list | ✗ reshaped | L3 (per-line, see below) |
| #886 | deps.ts:452 new functions | A | ✓ | today |
| #886 | deps.ts:1349 validation lines after an edited line | A | ✓ | today |
| #886 | deps.ts:1365 SQL `SET … = ?` and `.bind(…)` | C coupled lists | ✓ | today, but only because both lines anchor the same way. Tests guard it |
| #886 | features.json `doctor` | E | "clean", but it carries main's markers through | person, then L3 once main is fixed |

### Each resolver, measured

| Resolver | #893 settled | #886 settled | Left | Wrong answers |
|---|---|---|---|---|
| git, line diff3 | 0 / 10 | 0 / 19 | 29 | |
| codeSplitter today (line id + `mergeWords`) | 5 | 11 | 13 | features.json merges "clean" with main's markers in it |
| **L2**: today + 3 fixes to the existing merge | 7 | 12 | 10 | |
| **L3**: L2 + list-aware union inside reshaped stretches, main first | 9 | 16 | **4** | |
| Plain token diff3 over the hunk (rejected) | 6 clean | 18 clean | 5 | 3 broken, and features.json's markers carried through: `held: f.held.value,, digs rank }`, `?? {peers } }`, `versions,,` |
| `mergeWords(…, both)` over the whole hunk (rejected) | 6 clean | 17 clean | 6 | 2 broken: the multi-line registry fetch misaligned (`?? Record<string, string> {}`), and two new test blocks interleaved word by word |
| AI + build/test check | covers the 3 D hunks | | | |

The two rejected rows are why L3 isn't "union the words". Raw tokens get separators wrong at the end
of a list, and words matched across many lines line up the wrong braces. What works is to pair lines first, then
merge items inside each paired line, and never word-merge blocks that only one side has.

## 2. Why they all edit the same lines

Of the 34 commits to `apps/codesplitter` in main's first-parent history:

- `client.html` (5,863 lines, 193 over 300 chars) changed in 18
- README.md and REFERENCE.md changed in 13 each
- `api.ts` changed in 12, `openapi.ts` in 9
- `worker.ts` and `features.json` changed in 8 each

REFERENCE.md has 52 lines over 300 chars. Its longest is the doctor bullet, a 6 KB paragraph on one line.

| Hot spot | Why every feature touches it | Seen here |
|---|---|---|
| Registries and lists: imports, route tables, `api.ts` endpoints, `features.json`, test imports | A feature has to be registered somewhere central | worker.ts, deps.test.ts and client.test.ts imports, api.ts |
| Long one-liners holding many items | House style keeps short structs on one line. Prose bullets are one line per feature | `DEFAULTS`, `Report`, the save body, the SQL `SET`, every README/REFERENCE bullet |
| Shared config objects and schemas | A setting is added to the type, the defaults, the validator, the SQL, the API sketch and the form: **six lists edited in lockstep** | #886 and #863 each touched all six (`digs` and `rank`) |
| Append at end of section | New code goes after the newest sibling, so two agents pick the same spot | most A hunks |
| Numbered registries | The next free number is the same for both | `migrations/0069_beams.sql` (main) vs. `0069_deps_rank.sql` (#886): git merges it clean, `test/migrations.test.ts` fails it. `SHARED` already lists two past clashes (0052, 0056) |
| Real logic overlap | Two features change one function | `drawGraph`, `depUpdate`, `Registry`/`Meta` |

## 3. Deterministic resolvers

Each runs inside `merge()` in `lines.ts`, before anything is called a conflict. Rules apply in order, and the first one that settles a hunk wins.

| Level | Rule | Settles | Guard |
|---|---|---|---|
| L1 (today) | Line id, a word merge for a line both edited, identical inserts land once | A, B, most C | Already in place: the rename guard, strict deletes in code, keyed config, lockfiles |
| **L2a** | `diffToOps` pairs a changed old line with its *most similar* new line, not the first one in position | worker.ts import | |
| **L2b** | In prose and comments, the rename guard ignores stopwords and words under 3 letters | #893 README | Code keeps the full guard |
| **L2c** | "Doubled" fires only when the repeated line would land in the same block. Boilerplate inside two new test bodies is not a double | deps.test.ts tests | The build check catches a real duplicate declaration |
| **L3** | Inside a stretch both sides reshaped: pair lines by similarity, then merge **items** inside each pair. Items are split on the line's own list syntax: `{…}`, `[…]`, `(…)`, `import {…}`, `,`/`;` separators, CSS rules, and sentences in prose. Add by key, and dedupe identical adds. Lines only one side has pass through whole | CSS, `<g class>`, save body, `DEFAULTS`, `Report`, registry fetch | Refused if one side renamed a key the other uses (today's rename guard, per item) |
| Ordering | Two inserts at one spot: **main's first** (it landed first), then the branch's. If the base list is sorted, insert sorted instead | every same-spot insert | Deterministic because main is linear |
| Structural | JSON, YAML and TOML merge by key (already: `keyed`). A JSON, YAML or TOML file that doesn't parse after the merge is refused | features.json | Refuse any side that contains `<<<<<<<` or `>>>>>>>` lines |
| Order of operations | Merge a queue of branches oldest first, each against main as the previous one left it (`POST /merges`, #903, already does this). Rebasing in that order is the same thing. OT/CRDT is not needed here: a branch merge sees all three versions | ordering across PRs | |

**Coupled lists.** The SQL `SET a = ?, …` and its `.bind(a, …)` merge correctly only because both
sides inserted at matching positions. A union can't see that coupling. The fix is a convention (one
object drives both, see §5), and the test suite is the backstop.

**"Build lines, not edit lines".** Where a feature can add its *own* line, file or key instead of
editing a shared one, the merge has nothing to decide. §5 lists where that applies here.

## 4. Queues and reservations for hot lines

[line-locks.md](line-locks.md) compares leases, FIFO queues, intents and CRDTs for live edits on one
file. Phases 1 to 3 are #926, #927 and #928. That doc doesn't cover what follows from these numbers:

- **Commutative edits need no queue.** Adding an import, a key or a sentence commutes under L3. 25 of the 29 hunks are commutative. Making an agent wait in line for an import line just adds latency.
- **Reserve only non-commutative work.** Restructuring a function or extracting a type (the 3 D hunks) is where a lease or an intent (#926, #927) pays off. An agent that is about to extract `depUpdate()` should post an intent over the range, and an agent editing inside it sees the intent and waits or works elsewhere.
- **The merge tells the two apart.** A branch whose hunks all settle by L1–L3 is commutative with main and can merge without asking anyone. One with a D hunk is what a person or a checked AI looks at.
- **Line ids make queues cheap.** A queue or claim names line ids, which survive other agents' inserts above. A claim on "the `DEFAULTS` line" doesn't drift when someone adds an import.

## 5. Conventions that remove hot spots

| Convention | Removes | Where in apps/codesplitter |
|---|---|---|
| One item per line, trailing comma, for objects, types and import lists that grow | Bucket C becomes plain line inserts that L1 settles | `DEFAULTS`, `Settings`, `Report`, `Update` in deps.ts; worker.ts imports; the deps save body in client.html |
| One sentence per line in Markdown (semantic line breaks). It renders the same | Paragraph clashes become line inserts. README and REFERENCE have 71 lines over 300 chars | every README/REFERENCE feature bullet |
| One setting, one declaration: build the SQL `SET`, `.bind`, validator and API sketch from one field list | Six lockstep lists and the SQL coupling | deps.ts settings (`digs`, `rank`, `preview`, …) |
| Each feature registers itself in its own file: routes by `xRoutes()` per module, which worker.ts already does for most | Route tables and the import line | worker.ts imports, `api.ts` endpoints |
| Generated indexes: `features.json`, the README feature list and the REFERENCE file table built from per-feature entries | Shared registries | `features.json` (conflict markers went unnoticed there), REFERENCE file table |
| Timestamped migration names, not the next number | Number clashes | `migrations/` (`0069_*` ×2 now) |
| Split `client.html` by view | It's in 53% of commits, so most overlaps start here | the deps panel, the vein, the commit graph |

The first three cover 12 of the 15 C hunks measured here. The other 3 are the CSS rule line and two HTML templates in client.html, which L3 settles.

## 6. When an AI resolver is right

Only after L1–L3, and only for what's left: bucket D, where one side changed structure (extracted a function or a
type, removed a call) and the other edited what moved. Today's `conflict-agent.ts` already gets
git's markers with main's lines around them. What's missing is the check:

1. Deterministic rules first. The AI never sees a hunk L3 settles.
2. The AI gets the hunk, both sides' commit messages and the **already-settled merge of the rest of the file**, so it edits the real result.
3. Its answer is accepted only if the file parses (JSON, TS, HTML script blocks), the build passes, and the tests for the touched files pass in a throwaway clone. The doctor's tester already does this for updates.
4. If that fails, the hunk goes to a person with the AI's attempt and the failure attached. It never lands on the AI's say-so.

For the 3 D hunks here, every right answer can be checked by a build or a test. The AI ports `rank` and `yielded` into
`depUpdate()`, adds `peers?` to `Meta`, and keeps the pulse code next to the branch's `drawGraph()`.

## 7. Found along the way

- **main's `src/features.json` didn't parse.** #884's squash merge committed `<<<<<<< HEAD`, so the home page's feature strip fell back to `[]`. This PR first fixed it with the deterministic answer: both of main's sentences, the dig sentence first. main has since fixed it the same way, so the PR no longer changes the file. The guard against it recurring is part of the second next step below.
- **The deps.test.ts "doubled" conflict was hiding a broken merge** (#933). Each side's diff read its new test as starting a few lines up, inside the test before it, since both end in the same `await send(…)`, `await settle(call)`, `expect(…)`, `});`. The two sides started it at different lines, so the union cut a test in half, and git's `--union` merge of the file does the same. `diffToOps` now slides each added block as far down as the repeated lines allow, so both sides add it under the blank line. With L2a–c, L3 and the ordering rule in, these 29 hunks leave 3 conflicts, the D hunks, and every merged `.ts` file parses. `features.json` (E) still carries main's markers.
- **The `doctor` line conflicted again after #886 merged.** This wasn't two PRs appending to one line. It was the markers #884 committed. See section 8.

## 8. Committed conflict markers are a conflict source

#884 (`09d9443`, 03:00) committed `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` around the `doctor` line of `src/features.json`. Nothing parses that file in a test, so CI passed. #886 (`50fec50`) removed them on main. Every branch cut between those two commits inherited the markers and removed them its own way, so each one "edited the same line" as main. That is why #893 conflicted on `doctor` a second time, and #936 did too. The fix for each is to take main's line, which also has #886's "Rank the packages…" sentence.

So one bad merge commit turns into a conflict for every branch open at the time. Two cheap checks catch it before it lands:

- **Reject marker lines in CI.** Fail any tracked file with a line starting `<<<<<<< `, `=======` on its own line, or `>>>>>>> ` (`git grep -nE '^(<{7} |={7}$|>{7} )'`), excluding fixtures that need them on purpose.
- **Parse JSON registries in a test.** A test that loads `features.json` (and the other JSON registries) with `JSON.parse` fails on markers, and on any other break.
- **`migrations/0069_*` will clash** once #886 lands. `test/migrations.test.ts` catches it, so #886 has to renumber.

## 9. Shadow mode: every merge this repo already made

Sections 1–8 measured two PRs. `scripts/shadow.ts` (#1014) replays every merged PR from local git
history: the squash onto main (main just before it, the PR's head) and each time a branch took main in
on the way. Every file both sides changed goes through `git merge-file` and through `merge()` +
`lintMerge()`, as a branch merge runs them. Each clean result is checked against what landed.

```sh
bun scripts/shadow.ts      # every merged PR; --pr 893,886 for some; --json for the details
```

On 2026-10-12, against main `177f16f`: 653 merges from 543 PRs, 619 files both sides changed.

| Verdict | Files | What it was |
|---|---|---|
| Agree | 406 | the same clean result |
| Both conflict | 59 | |
| **git conflicts, ours is clean** | 139 | 61 exactly what landed. 29 the same lines in another order. 49 differ, mostly fixes the resolver made in the merge commit (a renamed endpoint's calls, #241). Build and test them next: #1043 |
| Ours conflicts, git is clean | 1 | #244's `.gitignore`: both added `!.env.schema` a line apart, and git kept it twice. Ours asks. Now a fixture |
| A guard tripped | 6 | redeclared names, an undefined name, code that won't parse. git conflicted on all 6 too, so none hid a merge git called clean |
| Lockfile both changed | 8 | a conflict by design (keep a side, regenerate). git's line merge is what landed |
| Both clean, different text | 0 | |

One mistake turned up, in the 49: #960's `index.html` got two head pickers with the same `id="heads"`. Each side
added one in a different place, and a line merge keeps both (#1044).

Most PRs merged as a squash of a branch already up to date with main, so their final merge is trivial.
The real conflicts were settled when a branch took main in.

## Next steps

Filed as issues, linked from the PR:

1. **Settle lists and paragraphs deterministically in the merge**: L2a–c and L3 with the ordering rule, with these 29 hunks as fixtures.
2. **A checked AI fallback, and refuse broken input**: run `conflict-agent` after L3 against the settled file, require parse + build + tests before its answer is offered, and refuse any side with conflict markers or JSON that doesn't parse. Done in #934: the agent sees the settled file and main's commit messages (a branch doesn't commit; one an agent run made gets that run's task instead, #986), its answer must parse and pass the repo's tests in a throwaway clone where the owner turned that on (its own switch since #998, apart from the doctor's run tests), and `merge()` refuses markers a branch brings in and JSON, YAML or TOML both sides parse that the merge breaks (YAML and TOML in #986). The CI marker check landed in #937.
3. **Repo conventions for apps/codesplitter**: one item per line for growing objects and imports, one sentence per line in the docs, timestamped migrations, and a generated `features.json`.
