# borg

> **What it proves:** the local twins behave like Cloudflare, not just look like it. One small Worker uses every binding once, and the same suite checks it on the desktop host and on a deploy. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

This is **slim borg**, the thin one. It isn't an app anyone uses: it's the test rig you run a change against.

| Check | What has to hold |
|---|---|
| `kv` | put, get, list by prefix, delete |
| `d1` | insert with bound values, read back |
| `d1-batch` | a batch is one transaction: a failing statement rolls back the ones before it |
| `r2` | put, get, head, list, delete |
| `do` | ten concurrent read-then-write requests to one object land as ten counts (the input gate); another id starts fresh |
| `ws` | a hibernating socket keeps its attachment and echoes |
| `queue` | a sent message reaches the consumer |

Every run uses fresh keys, so it's safe against a store that already has data in it.

## Run it

```sh
cd apps/borg
bun test test                        # builds the dev host, runs every check on the local twins
bun borg.ts https://borg-slim.<you>.workers.dev   # the same checks against a deploy
bun borg.ts http://127.0.0.1:<port> --token <t>   # or against a desktop host you started
```

`bun test test` is what CI runs on every PR that touches this app or `packages/`. It's free: nothing leaves the machine.

To check the edge, `rustybuns plan` then `rustybuns deploy` from here, run `bun borg.ts` against the URL, and `rustybuns destroy` when it's done. Everything in the stack is billed by usage, and one run sits inside Cloudflare's free allowances; `plan` lists each resource first.

## Where it's going

Slim borg checks each primitive once; what's left for it is in [#855](https://github.com/QuinnsCode/RustyBuns/issues/855). Two bigger rigs are planned:

- **thick borg** ([#856](https://github.com/QuinnsCode/RustyBuns/issues/856)): a decent-sized app per common migration story (keep the database and move the code, leave a PaaS for a box, go all-edge).
- **fatty borg** ([#857](https://github.com/QuinnsCode/RustyBuns/issues/857)): the chunky examples (codeSplitter, tscircuit-desktop, park-hide-seek, agent-office) run through build, deploy and teardown.
