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
The one place a stretch is read as one text is a statement one side joined onto a line or wrapped onto
several while the other only edited its lines (#1256): no more than four lines a side, so no braces to
misalign, and laid out the way the side that moved the breaks did.

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
| **L2b** | In prose and comments, the rename guard ignores stopwords and words under 3 letters, but not numbers | #893 README; #1221's README, where one sentence took a new clause on main and 32→64 on the branch (#1222) | Code keeps the full guard. A number one side changed that the other side's new words quote is still a conflict |
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

## 10. Replay through the whole app

Shadow mode runs `merge()` on three texts. `scripts/merge-replay.ts` (#1097) runs five of those
"merge main into the PR branch" fixes through the mirror, the way a branch actually comes in. That
way a file the mirror skips, holds as a blob or lints shows up too. Upstream is a bare repo that
borrows this clone's objects, with main at the merge base and `pr` at the branch's tip. A pull-only
mirror opens `pr`, then main moves to the merge's main parent and the mirror syncs. The branch
review's ops, applied to main's copy, give the text codeSplitter would settle, which is then diffed
against the merge commit. It all runs in-process on the local twins in a temp dir, with no GitHub
and no Cloudflare.

```sh
bun scripts/merge-replay.ts          # the five below; or pass merge commits; --json for the details
```

| PR (fix commit) | git conflicted | settled | left as cards | settled vs the fix |
|---|---|---|---|---|
| #1081 (`e49e19a`) | 7 | 4 | README (2), `sim.ts` (1), `main.ts` (1) | 3 exact. `rules.test.ts` kept both sides, but main's new test uses the factions' old names (#1096). Plus `view.ts`: git merged it clean into code that doesn't build (`r` is not defined), and the lint made it a card |
| #1066 (`c0487ab`) | 3 | 3 | none | 2 exact, `priority.ts` reordered. `bun.lock` now comes over as a blob (#1094) |
| #1051 (`0e0f81e`) | 2 | 1 | `migrations.test.ts` (2) | `branches.ts` reordered: two independent statements |
| #1027 (`1204866`) | 3 | 3 | none | 1 exact; the README and `write.ts` reordered |
| #995 (`14fa8c3`) | 2 | 2 | none | both exact |

Of 17 files git conflicted on, codeSplitter settled 13: 8 exactly as the person did, 4 with the
same lines in another order (both sides added at one spot, and no order changed behaviour), and 1
semantic miss (#1096). It left 4 as cards and caught 1 broken clean merge of git's. It never dropped
a side. The two holes the replay found, a skipped big file (#1094) and a blob merge over main's
change (#1095), were fixed in #1098.

### 2026-10-12 replay: a day of Two Fronts and README clashes

That day's seven "merge main into the PR" commits, run through the same replay against main `08d6601`, and
#1148's (`0fb458f`) against main `31aa72e` and again, after #1156, against `9137d57`, with the same result:

```sh
bun scripts/merge-replay.ts b070fd8 02e1045 401eeda e2f2145 2086218 db4095c 03e9127 0fb458f --json
```

| PR (fix commit) | git conflicted on | codeSplitter vs the fix |
|---|---|---|
| #1093 vs #1102 (`b070fd8`) | two-fronts `README.md`, `main.ts` | README exact; `main.ts` 1 card |
| #1093 vs #1087 (`02e1045`) | two-fronts `README.md`, `main.ts`, `war/rules.ts` | `rules.ts` exact; README 1 card, `main.ts` 3 cards |
| #1100 (`401eeda`) | root `README.md`, two-fronts `README.md`, `main.ts`, `styles.css`, `war/rules.ts`, `test/rules.test.ts` | root README exact; `styles.css` reordered; `rules.test.ts` settled differently; two-fronts README 1 card, `main.ts` 5 cards, `rules.ts` 3 cards |
| #1110 (`e2f2145`) | `README.md` | exact |
| #1115 (`2086218`) | `README.md` | 1 card |
| #1119 (`db4095c`) | codesplitter `src/agent-run.ts` | exact |
| #1124 (`03e9127`) | cli `test/init.test.ts` | settled differently: ordering only |
| #1148 (`0fb458f`) | root `README.md`, `REFERENCE.md`, cli `src/build.ts`, `src/config-schema.ts`, `test/config-schema.test.ts`, `test/glue.test.ts` | README exact; `config-schema.test.ts` reordered; `REFERENCE.md`, `config-schema.ts`, `glue.test.ts` settled differently; `build.ts` 3 cards |

Of 21 files git conflicted on, 8 needed nobody: 6 came out exactly like the fix, and 2 had the same lines in
another order (`styles.css`'s `.quick #dogfight` moved down a few lines, which doesn't change what it styles;
#1148's new schema tests landed in another order). 8 went to cards. 5 were settled silently but differently,
and none lost a side:

- **`init.test.ts`, harmless.** Both sides added a test at the same spot. It kept both, with the branch's
  test after main's rather than before it, and lost the blank line between them.
- **`rules.test.ts`, a real miss.** #1093 on main renamed `hero` to `heroes.<faction>`, and #1100's new test
  still says `won.hero.xp` and `lost.hero.woundedUntil`. The person renamed them; the merge kept them, so the file
  wouldn't typecheck. It's the #1096 case again. The replay is a dry run of the line merge, so it doesn't run
  #1109's test check, which is what would send this back as a card. Since #1156 the merge carries main's rename into
  the branch's new lines, and this file replays exactly like the fix.
- **#1148's `REFERENCE.md`, harmless.** Both sides added a clause to the one-line `hyperdrive` row. It kept
  both, main's PGlite clause before the branch's Neon one, where the person put Neon first and added
  "(or `urlSecret`)". Plus a trailing blank line.
- **#1148's `glue.test.ts`, harmless.** Both sides added a test at one spot. It kept both, the PGlite test
  before the branch's rather than last.
- **#1148's `config-schema.ts`, a real rewrite.** The branch rebuilt the hyperdrive check as a ternary chain
  (a Neon `origin` needs no `urlSecret`); main added a `migrationsDir` clause to the old one. Both clauses
  survive, but a Neon binding with no `urlSecret` returns early, so its `migrationsDir` goes unchecked. The
  person reworked the chain so it doesn't. Only a test of that case would catch it. Since #1168 a code stretch
  where both sides edited links of one `? :` or `&&` chain is a card, so this one goes to a person or the checked AI.

#1148's three `build.ts` cards, and what would settle each:

- **L11, the `./config.ts` import**: main added `Binding`, the branch added `hyperdriveUrlEnv` and moved
  `type` inside the braces. A one-line list both sides grew: L3. Main's `Binding` needed a `type` of its own once
  the branch dropped `import type`, and the word merge saw that as a clash. Since #1168 the merge reads an
  `import type { … }` as `import { type … }` when the other side switched forms, and this line settles like the fix.
- **L133, `const pgs`**: main kept the whole binding (`[n, b]`), the branch mapped it to
  `hyperdriveUrlEnv(n, b)`. Real rewrite.
- **L468, the desktop `hyperdrive` case**: main moved it into `hyperdriveBinding()`, the branch changed the
  env name inside the old call. Real rewrite.

`02e1045` also shows five files git merged clean that differ from the fix (`edge/campaign.ts`, `net.ts`,
`war/table.ts` and two tests). codeSplitter's text matches git's clean merge in all five. The person wired
#1087's galaxy pick through them in the merge commit itself, which no line merge can do.

No new engine bugs: nothing dropped a side. Of the two semantic misses, `rules.test.ts` is a known class with fixes
already in (#1109, and #1156, after which it replays exactly), and `config-schema.ts` is a real rewrite that only a test of the Neon-plus-`migrationsDir` case would send back.
Since #1168 `0fb458f` replays with `config-schema.ts` as 1 card and `build.ts` down to its 2 real rewrites.

### 2026-10-12 replay, evening round: 14 fixes on main `6a8a16d`

The evening merge round's 14 hand-fixed "merge main" commits, replayed on main's engine at `6a8a16d`:

```sh
bun scripts/merge-replay.ts 86061e8 137baa3 0ebf5e2 5955abe 70702de 4b8666b 77af4b1 798a8ef d7ffea8 04a8fff 2d8cd97 1676275 1ff6e0a 6379a0a
```

| PR (fix commit) | git conflicted on | codeSplitter vs the fix |
|---|---|---|
| #1182 (`86061e8`) | 12 files: root docs, cli `build.ts`, `config-schema.ts`, `config.ts`, `glue/infer.ts`, `index.ts`, two tests, shell-bun `app-server.ts` | all 12 exact |
| #1189 (`137baa3`) | git-recon `README.md`, `sim/game.ts`, `ui/main.ts`, `ui/scene.ts` | README and `scene.ts` differ; `game.ts` 2 cards, `main.ts` 1 card |
| #1191 (`0ebf5e2`) | codesplitter `REFERENCE.md`, `api.ts`, `branches.ts`, `openapi.ts`, `test/merge-plan.test.ts` | 2 exact; `merge-plan.test.ts` differs; `branches.ts` 1 card (the lint), `openapi.ts` 1 card |
| #1199 (`5955abe`) | cli `src/index.ts` | exact |
| #1199 (`70702de`) | cli `src/wrangler.ts`, `test/init.test.ts` | both differ |
| #1205 (`4b8666b`) | git-recon `README.md`, `net/world.ts`, `tests/battle.test.ts` | 2 exact; README differs |
| #1210 (`77af4b1`) | codesplitter `src/mirror.ts` | 3 cards |
| #1214 (`798a8ef`) | git-recon `README.md` | exact |
| #1214 (`d7ffea8`) | git-recon `README.md`, `net/mirror.ts`, `net/room.ts`, `ui/main.ts`, `ui/net.ts` | README differs; the other four 1, 1, 1 and 2 cards |
| #1221 (`04a8fff`) | git-recon `README.md` | 1 card |
| #1221 (`2d8cd97`) | git-recon `README.md` | differs |
| #1227 (`1676275`) | codesplitter `src/mirror.ts` | differs |
| #1229 (`1ff6e0a`) | cli `src/index.ts`, `test/init.test.ts` | `index.ts` differs; `init.test.ts` reordered |
| #1240 (`6379a0a`) | root `REFERENCE.md` | exact |

Git conflicted on 40 files. codeSplitter settled 30 of them: 19 exact, 1 reordered and 10 with other text. It left 10 as cards. Nothing git merged clean was raised.

#### The 10 that settled to other text

Each is graded (a) the engine is wrong, (b) the person's fix is wrong or lost something, or (c) both are fine.

| fix | file | grade | what differs |
|---|---|---|---|
| #1189 | git-recon `ui/scene.ts` | **(a), silent** | Main wrapped `s.alive \|\| b.down < …` as `!s.hidden && !s.gone && (…)`, and the branch as `(…) && ride?.kind !== "heli"`. The word merge made it `!s.hidden && !(s.gone && (…)) && …`. Dead soldiers who finished sinking, and players who left, are drawn again. It typechecks, and no test draws the scene. The fix keeps both sides' clauses at their own level. The import's `type RepoSnapshot` landing last is (c). #1255 |
| #1199 `70702de` | cli `src/wrangler.ts` | **(a)**, a test catches it | The same shape: main's `\|\| (k === "containers" && …)` and the branch's `&& !(k === "limits" && …)` joined with no brackets, so the `limits` clause hangs off the `containers` one and never runs. The branch's own new `subrequests` test fails on it. #1255 |
| #1199 `70702de` | cli `test/init.test.ts` | **(b)** | codeSplitter kept the branch's `{ limits: { cpu_ms, subrequests } }` → `["limits"]` test. The fix took main's `"limits"` in `HANDLED` and dropped that test with the branch's clause. So `init` on main no longer warns that a `limits.subrequests` was dropped. #1258 |
| #1191 | codesplitter `test/merge-plan.test.ts` | (c) | Both sides added a `describe` at the end of the file. It put the branch's (#1163) before main's (#1162), the fix after, and the blank line between them went missing |
| #1227 | codesplitter `src/mirror.ts` | (c) | Main wrapped the two catch-up calls in `if (theirs) { … }`. The branch's new `if (theirs) await postOrder(…)` landed after the closing brace with the old indentation. The fix moved it inside. It does the same thing, but the indentation is off |
| #1229 | cli `src/index.ts` | (c) | The branch hoisted `const stage = alchemyStage(rawArgs)` and swapped every `alchemyStage(args)` for `stage`. Main's new offline-plan line kept `alchemyStage(args)`. It's the same value, but not the branch's refactor. #1257 |
| #1189 | git-recon `README.md` | (c) + stale | Rows and bullets both sides added at one spot came out in the other order. The person also wrote how roles (branch) and battles (main) meet: "On your own, down 15", "In a battle everyone carries every gun", keys `1`-`9` again. That is code the merge left as `game.ts` cards. #1254 |
| #1205 | git-recon `README.md` | stale | Main had no costs paragraph yet, so the branch's went in as written, with "(about 66 KB/s a player, #1183)". Main's binary deltas had made that 16 KB/s, and the person said so. #1254 |
| #1214 `d7ffea8` | git-recon `README.md` | stale | Main's "The page acks with each input." The person added "and each snapshot echoes the newest input the world had" for the branch's input replay. #1254 |
| #1221 `2d8cd97` | git-recon `README.md` | stale | Main's "16 KB/s", "a full room of 32 … $0.03". The branch raised the cap to 64, and the person rewrote them as 25 KB/s, 64 and $0.06. #1254 |

"Stale" means the merge is faithful to both sides, but the text says something one side made untrue. No line merge can know that. What's missing is a flag, not a different merge.

#### The 10 left as cards

| fix | file | card | what would settle it |
|---|---|---|---|
| #1191 | codesplitter `src/branches.ts` | lint: `` `dry` is not defined (line 626) `` | **The refusal was right.** The branch moved `mergeBranch`'s dry run into its own function, which returns `{ dry }`. Main's new `rebuilt(…, dry, user)` line still names the old local, so the settled text would not run. The fix says `run.dry`. A function-scoped version of #1156's rename carry would settle it like the fix. #1257 |
| #1191 | codesplitter `src/openapi.ts` L317 | both added a last field to one `ok: obj({ … })`, the branch on a wrapped line | A list both grew (L3), read across the wrap: main's `regenerated` on the line, then the branch's `took` line. That's the fix. #1256 |
| #1214 `d7ffea8` | git-recon `ui/main.ts` L707 | main added `net.mirror.acked` to `input(…)`, and the branch joined `frame()` into it | A word merge across the join gives `input(net.mirror.frame(dt, input), now, net.mirror.acked)`, the fix. #1256 |
| #1214 `d7ffea8` | git-recon `ui/net.ts` L3 | header comment: main reworded it, the branch only added a sentence at the end | Main's comment plus the branch's new sentence. That's the fix, and a sentence rule would do it (not filed) |
| #1214 `d7ffea8` | git-recon `ui/net.ts` L55 | main changed the resend throttle, and the branch deleted it (inputs now always go) | A person. The fix took the deletion, but whether main's ack timing still needs a throttle is a design call |
| #1189 | git-recon `ui/main.ts` L384 | main reworded the "Weapons you have" comment, and the branch deleted the weapons row it heads | The comment goes with its code: a comment-only edit loses to a deletion of the block below it. That's the fix (not filed) |
| #1189 | git-recon `sim/game.ts` L240, L685 | L240: both added a parameter to `fromRepo` (`mode?`, `role?`) and to its `new Game(…)`, and each added a method below. L685: main changed the friendly-fire test, and the branch moved splash damage into a documented helper | L240's signature is a list both grew (L3), but the constructor call has to follow the constructor's merged order, and that is a card in the same file. L685 is an edit to code the other side moved and rewrote. Both are for a person or the checked AI |
| #1214 `d7ffea8` | git-recon `net/room.ts` L192 | main rebuilt the snapshot as a delta (`seq`, `base`, `...changed`), and the branch added `seq` to the old `you` | A person: the field the branch added lives in a structure main replaced |
| #1214 `d7ffea8` | git-recon `net/mirror.ts` L5 | both rewrote the header comment for their own feature | A person or the checked AI: two descriptions to merge into one |
| #1210 | codesplitter `src/mirror.ts` L1034–1043 | both restructured the one `if (tip === had) … else if (open)` chain | A person. The fix itself was redone in #1227 |
| #1221 `04a8fff` | git-recon `README.md` L91 | both edited the `room.ts` bullet's numbers | A person. The fix took main's numbers and dropped the branch's 64-player figures, measured before main's smaller snapshots. Stale again. #1254 |

So 4 card hunks are rule-shaped: `openapi.ts`, `ui/main.ts` L707, `ui/net.ts` L3 and `ui/main.ts` L384. With `branches.ts` that's 5, once a function-scoped rename lets its lint pass. The rest are rewrites where a person (or the checked AI) rightly decides.

#### Verdict and issues

Nothing dropped a side, but this round has the first **silent bad merges** since §10 began: two lines where both sides wrapped one expression in `&&`/`||`, and the word merge changed the grouping (#1255). `scene.ts` gets past typecheck and tests. `wrangler.ts` is caught only by the branch's own test. The commonest miss (5 of the 20 files that weren't exact) is prose one side made untrue. That calls for a "check the facts" flag, not a different merge (#1254). Filed, most common first:

1. #1254: a paragraph the other side made untrue settles silently (5 files)
2. #1255: both sides wrap one expression in `&&`/`||`, and the grouping changes silently (2 lines)
3. #1256: settle an edit to a line the other side joined or wrapped (2 cards)
4. #1257: carry a branch's function-local rename or hoisted const into main's new lines (1 lint card, 1 harmless difference)
5. #1258: not the engine. #1199's fix lost the branch's `limits` warning in `init`

The comment rules (a sentence added to a comment the other side reworded, and a comment edit losing to the deletion of its code) are one card each, and are left unfiled for now.

Since #1255 the `scene.ts` and `wrangler.ts` lines are 1 card each. When both sides insert at one spot in code, the inserts are a card if
they join with different ones of `&&`, `||` and `??`, or if one joins with any of them and the other opens or closes
a paren it doesn't close or open. The five default replays don't change.

### 2026-10-14 replay: the two `--recent 10` flagged (#1781)

`bun scripts/merge-replay.ts --recent 10` (#1775) settled two files with no cards, to text that differs from the person's fix and
isn't just reordered. Replayed with `bun scripts/merge-replay.ts e45746ca e49e19a` and graded like the rounds above:

| fix | file | grade | what differs |
|---|---|---|---|
| `e45746ca` | codesplitter `test/client.test.ts` | (c) | Both sides added a `describe` after the same one: the branch's "rot mode" tests, and main's "api shares repeated reads". The engine put main's first and the branch's after, and the blank line between `});` and the branch's comment went missing. The fix put the branch's first. It's the same two things as #1191's `merge-plan.test.ts` above, an order tie-break and a blank line both inserts shared, and both orders run the same tests |
| `e49e19a` | two-fronts `test/rules.test.ts` | **(b)**, stale | The branch renamed both factions across the app (README, `galaxy.ts`, `sim.ts`, `battle.test.ts`). Main, which still had the old names, wrote four new log and comment lines in `rules.test.ts` with them. The merge kept both sides' lines faithfully, so the test asserts a name the game no longer uses. The fix renamed those four lines |

The engine is right on both: it kept what each side wrote. `client.test.ts` is cosmetic. `rules.test.ts` is the "settled, but untrue" class (#1254) in a
new shape: a name the branch removed from the rest of the app, used by lines main added. No engine change here; the person's fix is the right
one for `rules.test.ts`, and nothing in the merge for `client.test.ts` needs fixing.

### Settled, but untrue

The commonest miss in the replay of 14 later "merge main" fixes (#1254) was a README paragraph one side wrote
while the other side changed the facts it states: a bandwidth figure, a player cap, a price. The line merge
keeps both sides' words faithfully and the text is out of date. Since #1254 a prose merge returns `checks`
beside its conflicts: a stretch both sides changed where git would have stopped, or a line one side wrote
stating a number or `name` the other side took out of that section. The branch review shows each as a card
that doesn't hold Merge, with the facts the sides differ on, and Ask hands it to the checked agent with both
sides' commits. Of that replay's five rows, the four that settled silently (`4b8666b`, `2d8cd97`, `d7ffea8`,
`137baa3`) each come back with checks on the stretch the person fixed; `04a8fff` was a card already.

## 11. A merge plan: who waits for whom

On 2026-10-12 the PR agent dry-ran pairs of about 40 open PRs, laid them out as waves, and told a worker to
merge main in 9 times. The merge plan (`src/merge-plan.ts`, `GET …/merge-plan`, #1155) does the layout: a
branch clashes with one before it when it merges clean into main now and not once that one has landed, and
it goes one wave past the latest it clashes with. The test is codeSplitter's merge, not git's.

`scripts/merge-plan.ts` replays that day's fixes with main's own history as the first branch: from each
fix's merge base, every PR that landed before the fix, and whether the branch merged clean just before it and
not just after it.

```sh
bun scripts/merge-plan.ts          # the 9 below; or pass merge commits; --json for the details
```

| PR (fix commit) | blocker by git's merge | by codeSplitter's |
|---|---|---|
| #1081 (`e49e19a`) | #1078: 7 files | #1078: README, `sim.ts`, `main.ts`, and `view.ts`, which git merges clean into code that doesn't build |
| #1093 (`02e1045`) | #1087, the one the fix names: README, `main.ts`, `rules.ts` | #1087: README, `main.ts` |
| #1093 (`b070fd8`) | #1102, the one the fix names: README, `main.ts` | #1102: `main.ts` |
| #1100 (`401eeda`) | #1102: 4 files; #1093: root README, `styles.css` | #1102: two-fronts README, `main.ts`, `rules.ts` |
| #1110 (`e2f2145`) | #1107: README | none |
| #1115 (`2086218`) | #1110: README | #1110: README |
| #1119 (`db4095c`) | #1116: `agent-run.ts` | none |
| #1124 (`03e9127`) | #1120: `init.test.ts` | none |
| #1148 (`0fb458f`) | #1146: 6 files | #1146: `build.ts` |

By git's merge the plan puts all 9 behind a blocker that landed before the fix, the two named in a fix
message included, in three waves: #1100 and #1115 wait on #1093 and #1110, which waited themselves, as they
did that day. By codeSplitter's it's two waves, and 3 of the 9 (#1110, #1119, #1124) never wait: the replay
in §10 has their files settling exactly or with the same lines in another order.

Left for later: merging main into each branch that waits once its blocker lands (#1162), and warning before
a task starts that an open branch is rewriting the same files (#1163).

## 12. Mergiraf over the same hunks

Mergiraf is a structured merge driver: it parses both sides into syntax trees and merges the trees, and it falls
back to a line merge for files it has no grammar for. This runs it over the 29 hunks of §1 to see what it settles
that codeSplitter's merge does not, and the reverse (#1408).

Mergiraf 0.20.0 (`cargo install mergiraf --locked`), run once per file that main and the branch both changed, the
same three versions §1 used: base `d7ef133` / `9c6885a`, main `3826cb7`, and the branch tips `751673bb` (#893) and
`195d32cd` (#886).

```sh
mergiraf merge base left right -p src/deps.ts -o out    # exit 0 clean, 1 conflicts left
```

| | #893 | #886 | Left |
|---|---|---|---|
| git, line diff3 | 0 / 10 | 0 / 19 | 29 |
| **Mergiraf** | 4 | 2 | 22, plus features.json refused |
| codeSplitter today | 5 | 11 | 13 |
| codeSplitter L3 | 9 | 16 | 4 |

Every file Mergiraf called clean was read: no wrong answers. The 6 it settled:

- **Also settled today (4):** the `commitGraph` comment next to the changed signature (B), `client.test.ts` and `mirror.test.ts` (both added a test), and the `deps.test.ts` import list.
- **Mergiraf only, today (2):** the `worker.ts` `import { … } from "./mirror.ts"` line, and the `client.html` save body, which came out as `held: f.held.value, digs, rank }`. These are the hunks L2a and L3 are there for, and they settle both.

**What it does not settle.** All 9 `deps.ts` hunks, every README/REFERENCE paragraph, the CSS rule line, the `<g class>` template, the graph head template and the `Registry` rewrite stay conflicts. So do 12 hunks that codeSplitter settles today, such as the both-added-at-one-spot blocks (A) in `client.html` and `deps.ts`, and 7 more that L2/L3 settle, such as one-line `DEFAULTS` and `interface Report`. It matches nodes by tree position, so two sides that each edited the same long line, or reshaped the same stretch, are a conflict to it as much as to git.

**Where they agree.** Both refuse `features.json` while main's markers are in it: Mergiraf prints `left side contains conflict markers, falling back to Git` and returns git's conflict. codeSplitter used to merge it "clean" with the markers carried through (§7), and now refuses it too. Neither settles the 3 D hunks (`drawGraph`, `depUpdate`, `Registry`/`Meta`); those still need the AI and the build check.

**Verdict.** On these hunks Mergiraf settles nothing that L3 does not, and L3 settles 19 it leaves. That says these hunks are line-shaped, not that Mergiraf isn't useful: its tree match shines on code where lines are *reordered or moved*, which these hunks don't exercise, and it reads some 50 languages where Mervin reads three. And 29 hunks from one app is a small sample either way. So it didn't replace anything; it joined: Mervin now runs it as a second check on the files he leaves cards in ([Mergiraf in Mervin's toolbelt](mervin.md#mergiraf-in-mervins-toolbelt)).

## Next steps

Filed as issues, linked from the PR:

1. **Settle lists and paragraphs deterministically in the merge**: L2a–c and L3 with the ordering rule, with these 29 hunks as fixtures.
2. **A checked AI fallback, and refuse broken input**: run `conflict-agent` after L3 against the settled file, require parse + build + tests before its answer is offered, and refuse any side with conflict markers or JSON that doesn't parse. Done in #934: the agent sees the settled file and main's commit messages (a branch doesn't commit; one an agent run made gets that run's task instead, #986), its answer must parse and pass the repo's tests in a throwaway clone where the owner turned that on (its own switch since #998, apart from the doctor's run tests), and `merge()` refuses markers a branch brings in and JSON, YAML or TOML both sides parse that the merge breaks (YAML and TOML in #986). The CI marker check landed in #937.
3. **Repo conventions for apps/codesplitter**: one item per line for growing objects and imports, one sentence per line in the docs, timestamped migrations, and a generated `features.json`.
