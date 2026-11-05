# codeSplitter

The repo's [AGENTS.md](../../AGENTS.md) holds for this app too. This file adds the helpers that only codeSplitter has,
so agents working on the games don't load them.

## Cut before you add: codeSplitter's helpers

- Small shared helpers live in `src/util.ts` (imports nothing): `esc`, `plural`, `pad10`, `inBatches`, and it re-exports `hex`,
  `b64url`, `digest` and `sha256` from `@rustybuns/util/bytes`. Responses use `json` and request bodies `readBody` from `env.ts`;
  git runs through `git` and `isAncestor` in `mirror.ts`. Add to these, don't redefine them.
- One repo's row comes from `repoRow` in `src/repos.ts`, not another inline `FROM repos WHERE owner = ? AND name = ?`.
- A file's doc is `fileDoc` and its lines `fileLines` (`archive.ts`), not `toFile(...)` plus `.json()`; every file's
  Durable Object at once is `stubAll`; lockfile names are `lockfiles.ts`. Request bodies go through `readBody`, not
  `req.json().catch(() => null)`.
- When a table is always read together with another, add one query helper rather than another hand-written join:
  "the repo is still live" is `live(alias)`, joining it is `liveRepo(t)`, and a branch's row beside its files is
  `branchOf(t)`, all in `src/repos.ts`.
