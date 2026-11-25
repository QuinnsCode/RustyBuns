# hemyviz

Your Alchemy deployments, drawn live: every stack, every stage, every resource, in 2D, 2.5D and 3D, five ways each.
It reads Alchemy's state files and nothing else, so it needs no login and can't change a thing.

## Use it

```sh
bun run hemyviz            # this repo: every Rusty Buns app's shared state, every stage, every worktree
bun run hemyviz --demo     # a made-up fleet, to look around first
bun apps/hemyviz/src/main.ts --state path/to/.alchemy/state   # any Alchemy project (give --state more than once)
```

Open the link it prints (`http://127.0.0.1:4798/`; another port when that one is taken). The page asks for changes
every two seconds, so leave it open during a deploy and watch the blocks go blue and settle green.

- **2D / 2.5D / 3D** (top left, or `d` to cycle): a flat map, an isometric city, and a perspective view that turns on
  its own (the orbit button stops it). Drag pans (turns in 3D; shift-drag pans), the wheel or a pinch zooms, the
  frame button fits it again.
- **The five modes** (`1` to `5`):

| Mode | What it shows | Height |
| --- | --- | --- |
| Map | Each stack and stage is an island; columns go by what depends on what, arcs link them | how many depend on it directly |
| Health | Zones by status; anything `creating`, `updating`, `deleting` or `replacing` pulses | in flight stands taller |
| Age | A lane per stack: the oldest change on the left, the newest on the right | newer is taller |
| Kinds | Grouped by resource type, most common first | — |
| Blast | What a destroy takes with it, and what it keeps (retain/protect) in its own zone | everything that depends on it, all the way down |

- Click a block for its panel: type, status, stage, name and URL, when it changed, what feeds it and what it feeds
  (click those to hop along). Hover for a quick card. **Find** dims everything that doesn't match.
- The stack menu picks one stack (all its stages) or one stage. The URL keeps the view: `?dim=3d&mode=blast&stack=eqosys`.

## What it reads, and what it never shows

Alchemy keeps state at `<state dir>/<stack>/<stage>/<fqn>.json`. In this repo the Rusty Buns CLI shares each app's
state across worktrees under `<git common dir>/rustybuns/alchemy/<app path>/state` (`packages/cli/src/state.ts`), and
hemyviz reads all of those plus `./.alchemy/state`.

State files hold secrets in plain text (`{ "__redacted__": "..." }`), tokens and connection strings. So the server
copies **no prop or attr values** to the page: only the type, status, dependency edges, counts, the removal policy, and
a `name` and `url` from a short list of fields that are public anyway (`src/read.ts`). The server listens on
127.0.0.1 only. The test (`test/journey.test.ts`) plants a secret in props and attrs and checks it never leaves.

## How it's built

| File | What |
| --- | --- |
| `src/api.ts` | The `Fleet` shape the server writes and the page reads (guards) |
| `src/read.ts` | One state row -> a safe `Resource` (pure) |
| `src/scan.ts` | Finds state dirs and reads them; versions the fleet so an unchanged poll is a 204 |
| `src/layout.ts` | Fleet + mode -> scene: blocks, zones, links, legend. Pure and deterministic |
| `src/project.ts` | The three cameras and box faces (pure math, no canvas) |
| `src/page.ts` | One canvas draws every view; `window.hemyviz` is the probe handle |
| `src/demo.ts` | The demo fleet |

Every dimension draws the same scene through a different camera, so a new mode is one function in `layout.ts` and
shows up in all three. `bun run probe hemyviz --list` says what `window.hemyviz` does.

## Where it goes next

hemyviz is the read side of a self-hosted deploy panel. The plan, each step its own issue:

1. **A dashboard for every deploy.** Join each stack to its Rusty Buns config (`rustybuns infra --json`, the graph
   codeSplitter's infra map already draws) so planned-but-not-deployed resources show as ghosts, plus `drift` and
   each stage's REAL/EPHEMERAL tag.
2. **Stack a server.** The box target (Hetzner + Caddy + one systemd service per app) is already Alchemy resources:
   hemyviz draws it today. Next is acting from the panel: plan, deploy, restart a service, with the CLI's own
   confirmations, never a shortcut around them.
3. **Hosted, for a team.** Read Alchemy's HTTP state store instead of local files, sign in with eqosys, and watch a
   deploy together through a Qollab room.
