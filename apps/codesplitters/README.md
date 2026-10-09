# codeSplitters

> **What it proves:** a code host where every file is a Durable Object runs unchanged on a laptop, with sqlite standing in for D1 and for each file's storage. Several agents can edit one file at once, line by line. Proof of concept.

- **A file is a Durable Object.** It is the only writer for that file, so every edit from every agent lands in one order. Ops name lines by stable id, not index, so agents editing different lines never collide. Editing the same line is optimistic: an op carries the line's rev, and a stale one gets a 409 the agent retries. An edit that depends on other lines (is this variable ever reassigned?) sends `ifRev` and only lands if the whole file hasn't moved since it was read.
- **Every line knows who wrote it and when.** The op log replays the file at any rev: blame and time travel come free.
- **Cataloguing** (a commit) hashes the file with its parent, indexes it for search (D1 FTS5) and **pushes the repo to Cloudflare Artifacts** as a real git commit. Artifacts only takes writes as a git push, so `src/git.ts` builds the objects and the pack itself (Web Crypto and `CompressionStream`, no git library) and speaks smart HTTP. The repo page has a `git clone` line with an hour-long read token.
- **Public or private repos.** A private repo you can't see answers 404, in search too.
- **Your profile is your own HTML and CSS** (sandboxed, no scripts), plus **playlists**: line ranges from any file you can see, read live. A track holds its lines by id, so it follows them as the file changes around them.

Identity is a name in a cookie. That is not auth.

On the desktop, Artifacts is a Rusty Buns twin: bare repos in `~/.codesplitters/artifacts`, served by `git http-backend` behind each repo's tokens, so it needs `git` installed. On Cloudflare, Artifacts needs the Workers Paid plan (10k operations and 1 GB a month included).

```sh
cd apps/codesplitters
bun agents.ts      # three agents edit one file at once, in-process; prints the blame
bun test test
bun run desktop    # the app in a window; data lives in ~/.codesplitters
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
| `src/worker.ts` | routes, visibility, profiles, playlists, search, the push on catalogue |
| `src/git.ts` | a git push with no git library: objects, pack, receive-pack |
| `migrations/` | the D1 schema |
| `agents.ts` | the three-agent demo |
