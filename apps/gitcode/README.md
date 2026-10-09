# gitcode

> **What it proves:** a code host where every file is a Durable Object runs unchanged on a laptop, with sqlite standing in for D1 and for each file's storage. Several agents can edit one file at once, line by line. Proof of concept.

- **A file is a Durable Object.** It is the only writer for that file, so every edit from every agent lands in one order. Ops name lines by stable id, not index, so agents editing different lines never collide. Editing the same line is optimistic: an op carries the line's rev, and a stale one gets a 409 the agent retries.
- **Every line knows who wrote it and when.** The op log replays the file at any rev: blame and time travel come free.
- **Commits** hash the file with their parent, and the commit is what search indexes (D1 FTS5).
- **Public or private repos.** A private repo you can't see answers 404, in search too.
- **Your profile is your own HTML and CSS** (sandboxed, no scripts), plus **playlists**: line ranges from any file you can see, read live.

Identity is a name in a cookie. That is not auth.

```sh
cd apps/gitcode
bun agents.ts      # three agents edit one file at once, in-process; prints the blame
bun test test
bun run desktop    # the app in a window; data lives in ~/.gitcode
```

To watch the agents live, open a file in the app, then point the demo at it with the URL and token the host printed:

```sh
bun agents.ts --url http://127.0.0.1:PORT --cookie 'rb_token_PORT=TOKEN'
```

## Layout

| File | What |
|---|---|
| `src/lines.ts` | the line model: ops, conflicts, replay. Pure functions |
| `src/file-do.ts` | the file Durable Object: ops, log, time travel, commits, a live socket |
| `src/worker.ts` | routes, visibility, profiles, playlists, search |
| `migrations/` | the D1 schema |
| `agents.ts` | the three-agent demo |
