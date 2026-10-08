# 🥐 Agent Office, Rusty Buns-ified

[Agent Office](https://github.com/AgentSystemLabs/agent-office) (MIT) is the cartoon 3D office where
Claude Code workers sit at desks. Some of Rusty Buns was built in it. This example turns it around:
the office itself, on Bun, as **one file** you can copy to any Mac or Linux box. No Node, no
`npm ci`, nothing compiled on the server.

```sh
cd apps/agent-office
bun run office                 # fetch the latest release, Bun-ify it, open the office
bun run desktop:build          # dist/agent-office-<os>-<arch>
bun run desktop:build:all      # + darwin-x64, linux-x64, linux-arm64
```

Then `./dist/agent-office-linux-x64 --host 0.0.0.0` on a server, with all of Agent Office's own flags.
For HTTPS, voice and teams, follow its README; its `deploy/` scripts install Node and `npm ci`, and this
binary can stand in for that step.

## How

Nothing is forked. `scripts/rustybunsify.ts` downloads the release tarball (`AGENT_OFFICE_TAG` pins one),
installs it with Bun, and patches the copy in `./office`. Every patch fails loudly if its target moves.

| What | Why |
|---|---|
| `@lydell/node-pty` → [`shim/node-pty`](shim/node-pty/index.js) | The native addon spawns under Bun but its shell is hung up at once. ~80 lines over `Bun.spawn({ terminal })` replace it: no node-gyp, no prebuilds, and it survives `--compile`. |
| `@xterm/*` bundle their CJS `main` | Bun's bundler prefers `module`, whose ESM build has no default export. |
| `http/static.js` reads `$AGENT_OFFICE_PUBLIC_DIR` | The 3D client is embedded and unpacked once to `~/.cache/agent-office-rustybuns/<tag>/`. |
| `ptys.js` falls back to `$HOME` as the pty host's cwd | Inside a binary the code dir is the virtual `/$bunfs`. |
| `workers/process.js` points `office-workers` / `office-queue` at the binary | There's no `bin/` on disk to find. |

The binary has four jobs, picked by its first argument: the office, its pty host (the office re-runs
itself for that, as it does under Node), and the two helper commands workers call.

## Node vs Bun

`bun bench/bench.ts --runs 5` races the installed release on Node against the binary, on the office's
real paths. Medians from an M-series Mac (busy, so read differences under ~15% as noise):

| | Node 22 | Bun 1.4 binary | |
|---|---:|---:|---|
| startup to first page | 590 ms | 466 ms | 1.3x faster |
| office memory, idle | 115 MB | 76 MB | 1.5x less |
| pty host memory, idle | 75 MB | 31 MB | 2.4x less |
| terminal throughput (20 MB of ANSI) | 25 MB/s | 23 MB/s | tie |
| 10 live terminals, full scrollback | 301 MB | 291 MB | tie |

The wins are startup and idle memory. Busy terminals tie because the cost is the office's own JS:
every byte goes through a headless xterm (`bench/parse.mjs` shows it alone at ~20-70 MB/s, the same on both
runtimes), and each terminal keeps ~26 MB of scrollback. That parser is the obvious place for Rust.

## Limits

- macOS and Linux. Bun's PTY is POSIX only, so Windows still needs Node.
- The Linux binaries are cross-compiled from a Mac; the pty host is tested on macOS.
- Not `rustybuns build desktop`: that wraps Vite apps and Workers-shaped handlers, and this is a
  long-running server with terminals. It's the first sample for the planned sidecar mode (FRAMEWORKS.md).
