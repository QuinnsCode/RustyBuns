# Agent Page

> **What it proves:** a world any coding agent writes while you watch (Claude Code, Codex, opencode, T3 Code, or a
> browser agent with WebMCP), the way codeSplitter's profile page works: the agent writes real code (a canvas city, a
> three.js scene) and a sealed frame runs it. Effect UI runs the page around it, and an Effect Schema checks every
> write. One of the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Use it

```
cd apps/effect-ui-page
bun run dev              # http://127.0.0.1:4799
```

Open the page. It gives itself a room (`/r/<room>` in the address bar) and lands on one screen over a rainy night
city: the four parts it's built from (Effect UI, WebMCP, Cloudflare Artifacts, Effect), one line to copy, and four
pictures of what that line does. Three ready-made worlds (rainy city, solar system, fish tank; `src/worlds.ts`) load in
one click with no AI connected, on the landing, in the dock and in Cmd+K, each with one thing to ask your AI next. When your AI's first write arrives, the landing gives way to your world; "Skip to the
page" does it by hand. A room this browser already kept opens straight on its page. The dock beside it says how to
reach the room, with a copy button for each:

- **Paste into any agent.** "Copy the prompt" gives you a few lines to paste into Claude Code, Codex, opencode or
  T3 Code. They tell the agent to call the page's tools with `curl`, so there's nothing to install or configure.
- **Or add it as an MCP server**, so the tools show up as the agent's own:
  - Claude Code: `claude mcp add --transport http agent-page <room>/mcp`
  - Codex: `codex mcp add agent-page --url <room>/mcp`
  - opencode: `opencode mcp add agent-page --url <room>/mcp`
  - T3 Code runs Claude Code or Codex underneath, so add the server to whichever one it runs.
- **In the browser:** an agent with WebMCP (`document.modelContext`) sees the same tools on the page itself.

Then ask for a world: "make me a rainy neon city in three.js, slowly orbiting". The world reloads with each file the
agent writes, and the dock lists its calls. A new room starts with a small isometric rain city (`src/starter.ts`) to
change or throw away.

| Tool | Does |
|---|---|
| `page_read` | Each file's path and size, the backdrop, and what the frame said since it last loaded: errors with their file, loads it blocked |
| `page_read_file` | One file's whole text |
| `page_write_file` | Set one file (`index.html`, `world.js`, `lib/noise.js`, ...) to this text; `""` takes it away. Its description tells the agent how files load and what the frame allows |
| `page_edit_file` | Swap the one exact match of `find` in a file for `replace`, so a small change doesn't resend the file. No match, or more than one, is refused with the count |
| `page_set_backdrop` | A codeSplitter handle whose profile page (their public `page` repo) fills the window behind the world; `""` takes it away |
| `page_undo`, `page_reset` | Take back the last change, or go back to the starter city |

A write or an edit answers with the files (paths and sizes, not their text), or why it couldn't be done. The Undo and Start over
buttons do the same as the tools. This browser keeps each room's world for the next visit. **Full screen** (or `?full`
on the link) puts the dock away.

The room's link is its key: there's no sign-in, so share it only with agents you want building your world. The page
has to stay open: it holds the world, and an agent that calls while no tab is open is told to ask you to open it.

What keeps it safe, in short:

- **The sealed frame** (`src/world.ts`): the world runs in an `<iframe sandbox="allow-scripts">` with no same-origin,
  so it has no cookies, no storage and no reach into this page. A Content-Security-Policy goes first in its document:
  scripts and libraries only from esm.sh, jsDelivr, unpkg and cdnjs, no `fetch` or sockets out, no forms. A reporter
  in the frame sends its errors and blocked loads to the page, and `page_read` hands them to the agent.
- **The bouncer**: each write is checked by its Schema first: a file name like `world.js` (one folder deep at most,
  text types only), 100,000 characters a file, 400,000 and 30 files a world.
- Only a page this server served can hold a room's socket (its `Origin` must match), so another site that learns the
  link can't take the agent's calls. `bun run dev` listens on 127.0.0.1 only, not your Wi-Fi.
- What the world says goes back to the agent, so the prompt and the MCP instructions tell it page text is content,
  never instructions.

### `@world/kit`

A world's module can `import { world, ground, sky } from "@world/kit"` instead of writing the same three.js each
time (`src/kit.ts`, three.js 0.170.0 from esm.sh). The plot is 100 units square around 0.

| Call | Gives |
|---|---|
| `world({ orbit, distance, angle })` | The scene, a camera looking down at an angle, the renderer, resizing and the loop. Returns `{ scene, camera, renderer }` |
| `ground({ type, color })` | `flat`, `dunes`, `hills` or `grass`. `heightAt(x, z)` reads it |
| `sky(type)`, `weather(type)` | `day`, `night` (stars and a moon) or `dusk`; `rain`, `snow`, `fog` or `clear` |
| `water({ y, x, z, width, depth })` | A sheet of water |
| `trees(n)`, `cactus(n)`, `rocks(n)` | Scattered on the ground, never in water; `{ area, size, color }` |
| `lights({ sun, fill, color, at })`, `lamp({ x, y, z, color })` | The sun and sky light; a coloured glow |
| `every(f)`, `THREE` | Run `f(t, dt)` each frame; three.js for anything else |
| `onPlayer(cb)` | `cb(player, at)` when the page says a visitor is walking the plot (`{ agent_page: true, player: { x, z } \| null }`, 0 to 1). A world reacts to them and never draws them |

`test/fixtures/rain-city.js` is a whole rainy neon city by a river in about 30 lines of it.

### What a world costs in tokens

A fixed "build me a world" session (`test/session.ts`: `page_read`, read the starter's two files, write a small rainy
city, look, one fix, look) counted with the instructions and tool list once, each call's arguments and each reply, at
four characters a token (`scripts/mcp-session.ts`, the same session code as codeSplitter's `tool-tokens.ts`):

| | Tool list and instructions | Whole session |
|---|---|---|
| Before: three.js by hand, whole files resent | 682 | 4,473 |
| After: `@world/kit` and `page_edit_file` | 612 | 2,119 |

`test/tokens.test.ts` fails when the session passes the budget in `test/tokens.json`. A change that earns more tokens
raises it there, in the same PR. For Claude's own count on a live room: `apps/codesplitter/scripts/tool-tokens.ts`.

From a script or the console, the same tools are on `window.__commands`:

```
bun run probe effect-ui-page --js 'await __commands.run("page_read", {})'
```

## Deploy it

`bun run deploy` builds the page and ships it with the relay as one Worker (`wrangler.jsonc`). It has one small
Durable Object per room and no storage, AI or other paid bindings.

## How it's put together

- `src/page.ts`: the world (its files) and each tool's arguments as Effect Schemas, and `apply`, the one pure
  function that changes it. A tool's JSON Schema for the agent comes from the same Schema that checks its call.
- `src/world.ts`: the sealed frame's document: `index.html` with the world's own scripts and styles put inline, its
  modules' imports of each other through an import map, the policy and the reporter first. `src/starter.ts`: the
  starter city's two files. `src/kit.ts`: `@world/kit`'s source, a string the frame's import map carries.
- `src/answers.ts`: what the tools answer, shared by the page and the tests' stand-in for it (`test/app-kit.ts`).
- `src/tools.ts`: the tool list every door shares (WebMCP, HTTP, MCP) and the frames between the relay and the page.
- `src/agent.ts`: the `Agent` service in the page. Its Layer puts the WebMCP tools up (`@rustybuns/util/commands`)
  and keeps a socket to the room's relay while the page is mounted. A call from either becomes a message on a queue
  and waits for the page's report.
- `src/ProfilePage.ts`: the page as one Effect UI component (Model, messages, `update`, `view`): the world's frame,
  the landing and the Connect box.
  The agent's calls come in through a Subscription on that queue. Each change, the agent's or a person's click, ends
  with a `ReportPage` Command that answers the waiting call.
- `src/relay.ts`: a room's relay, with no platform code in it. It serves `GET /api/r/<room>/tools`,
  `POST /api/r/<room>/tools/<name>` and MCP over streamable HTTP at `/api/r/<room>/mcp`. Each call goes down the page's
  socket, and the reply comes back with the page's answer.
- `src/edge/worker.ts`: the relay on Cloudflare, one `Room` Durable Object per room. `scripts/dev.ts`: the same relay
  and the page in one Bun server.
- `test/page.test.ts`: the Schema checks, `apply`, the frame's document, a `Story` of an agent's writes through
  `update`, and `Scene`s of a person's clicks. `test/relay.test.ts`: HTTP and MCP calls to a fake page, a refusal, a missing page, a timeout. `test/tokens.test.ts`: the token budget.
  `test/kit.test.ts`: the dev server and headless Chrome, an edit seen in the frame and a kit world running there.

Effect UI is in public preview and not on npm yet, so `package.json` pins a pkg.pr.new snapshot by commit
(`@effect/ui@a0d7578`). To move it on: `bun add https://pkg.pr.new/Effect-TS/ui/@effect/ui@<commit>` in this folder.
