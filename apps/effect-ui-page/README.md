# Agent Page

> **What it proves:** an [Effect UI](https://ui.effect.website/) page that any coding agent builds while you watch:
> Claude Code, Codex, opencode, T3 Code, or a browser agent with WebMCP. It's codeSplitter's profile page idea
> (connect your agent, it makes your page) with every change checked by a Schema before it reaches the page. One of
> the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Use it

```
cd apps/effect-ui-page
bun run dev              # http://127.0.0.1:4799
```

Open the page. It gives itself a room (`/r/<room>` in the address bar) and the Connect box beside it says how to reach
it, with a copy button for each:

- **Paste into any agent.** "Copy the prompt" gives you a few lines to paste into Claude Code, Codex, opencode or
  T3 Code. They tell the agent to call the page's tools with `curl`, so there's nothing to install or configure.
- **Or add it as an MCP server**, so the tools show up as the agent's own:
  - Claude Code: `claude mcp add --transport http agent-page <room>/mcp`
  - Codex: `codex mcp add agent-page --url <room>/mcp`
  - opencode: `opencode mcp add agent-page --url <room>/mcp`
  - T3 Code runs Claude Code or Codex underneath, so add the server to whichever one it runs.
- **In the browser:** an agent with WebMCP (`document.modelContext`) sees the same tools on the page itself.

Then ask for a page: "make it a dark purple page about my rock climbing, with my stats and three links". The page
changes as the agent works, and the dock lists its calls.

| Tool | Does |
|---|---|
| `page_read` | The page as it stands: name, tagline, theme, blocks and their ids |
| `page_set_profile` | The name and the tagline |
| `page_set_theme` | Accent, paper and ink colors (`#rrggbb`) and the font (sans, serif, mono, rounded) |
| `page_add_block` | A text, links, stats, quote or tags block, at an index |
| `page_edit_block`, `page_move_block`, `page_remove_block` | Change, move or remove a block by id |
| `page_set_backdrop` | A codeSplitter handle whose profile page (their public `page` repo) fills the window behind the blocks, in a sandbox; `""` takes it away |
| `page_undo`, `page_reset` | Take back the last change, or start over |

Every write answers with the page after it, or why it couldn't be done (an unknown id names the ids there are). The
Undo and Start over buttons do the same as the tools. This browser keeps each room's page for the next visit. **Full screen** (or `?full` on the link) puts the dock away.

The room's link is its key: there's no sign-in, so share it only with agents you want building your page. The page has
to stay open: it holds the page, and an agent that calls while no tab is open is told to ask you to open it.

What keeps it safe, in short (the page says the same in its "How it works" card):

- An agent can only call the page's tools, and each call is checked by its Schema: text of a set length, `#rrggbb`
  colors, a font from a list, `https://` links. Nothing reaches your machine, and the page never runs what it's sent.
- Only a page this server served can hold a room's socket (its `Origin` must match), so another site that learns the
  link can't take the agent's calls. `bun run dev` listens on 127.0.0.1 only, not your Wi-Fi.
- What the page says goes back to the agent, so the prompt and the MCP instructions tell it page text is content,
  never instructions.

From a script or the console, the same tools are on `window.__commands`:

```
bun run probe effect-ui-page --js 'await __commands.run("page_set_profile", { name: "Ada" })'
```

## Deploy it

`bun run deploy` builds the page and ships it with the relay as one Worker (`wrangler.jsonc`). It has one small
Durable Object per room and no storage, AI or other paid bindings.

## How it's put together

- `src/page.ts`: the page and each tool's arguments as Effect Schemas, and `apply`, the one pure function that
  changes the page. A tool's JSON Schema for the agent comes from the same Schema that checks its call, so a color
  that isn't `#rrggbb` or a link that isn't `https://` never reaches the page.
- `src/tools.ts`: the tool list every door shares (WebMCP, HTTP, MCP) and the frames between the relay and the page.
- `src/agent.ts`: the `Agent` service in the page. Its Layer puts the WebMCP tools up (`@rustybuns/util/commands`)
  and keeps a socket to the room's relay while the page is mounted. A call from either becomes a message on a queue
  and waits for the page's report.
- `src/ProfilePage.ts`: the page as one Effect UI component (Model, messages, `update`, `view`), and the Connect box.
  The agent's calls come in through a Subscription on that queue. Each change, the agent's or a person's click, ends
  with a `ReportPage` Command that answers the waiting call.
- `src/relay.ts`: a room's relay, with no platform code in it. It serves `GET /api/r/<room>/tools`,
  `POST /api/r/<room>/tools/<name>` and MCP over streamable HTTP at `/api/r/<room>/mcp`. Each call goes down the page's
  socket, and the reply comes back with the page's answer.
- `src/edge/worker.ts`: the relay on Cloudflare, one `Room` Durable Object per room. `scripts/dev.ts`: the same relay
  and the page in one Bun server.
- `test/page.test.ts`: the Schema checks, `apply`, a `Story` of an agent's calls through `update`, and `Scene`s of a
  person's clicks. `test/relay.test.ts`: HTTP and MCP calls to a fake page, a refusal, a missing page, a timeout.

Effect UI is in public preview and not on npm yet, so `package.json` pins a pkg.pr.new snapshot by commit
(`@effect/ui@a0d7578`). To move it on: `bun add https://pkg.pr.new/Effect-TS/ui/@effect/ui@<commit>` in this folder.
