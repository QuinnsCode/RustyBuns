# Agent Page

> **What it proves:** an [Effect UI](https://ui.effect.website/) page that your agent builds through WebMCP. It's
> codeSplitter's profile page idea (connect your agent, it makes your page) with every change checked by a Schema
> before it reaches the page. One of the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Use it

```
cd apps/effect-ui-page
bun run dev
```

Open the page in a browser whose agent speaks WebMCP (`document.modelContext`) and ask it to build your page:
"make it a dark purple page about my rock climbing, with my stats and three links". It sees these tools:

| Tool | Does |
|---|---|
| `page_read` | The page as it stands: name, tagline, theme, blocks and their ids |
| `page_set_profile` | The name and the tagline |
| `page_set_theme` | Accent, paper and ink colors (`#rrggbb`) and the font (sans, serif, mono, rounded) |
| `page_add_block` | A text, links, stats, quote or tags block, at an index |
| `page_edit_block`, `page_move_block`, `page_remove_block` | Change, move or remove a block by id |
| `page_undo`, `page_reset` | Take back the last change, or start over |

Every write answers with the page after it, or why it couldn't be done (an unknown id names the ids there are).
The Undo and Start over buttons beside the page do the same as the tools, and the dock lists the agent's last calls.

No WebMCP in your browser? The same tools are on `window.__commands`, so the console (or `bun run probe`) drives it:

```
bun run probe effect-ui-page --js 'await __commands.run("page_set_profile", { name: "Ada" })'
```

## How it's put together

- `src/page.ts`: the page and each tool's arguments as Effect Schemas, and `apply`, the one pure function that
  changes the page. A tool's JSON Schema for the agent comes from the same Schema that checks its call, so a color
  that isn't `#rrggbb` or a link that isn't `https://` never reaches the page.
- `src/agent.ts`: the `Agent` service. Its Layer puts the WebMCP tools up (`@rustybuns/util/commands`) for as long
  as the page is mounted and takes them down when it goes. A call becomes a message on a queue and waits for the
  page's report.
- `src/ProfilePage.ts`: the page as one Effect UI component (Model, messages, `update`, `view`). The agent's calls come in
  through a Subscription on that queue. Each change, the agent's or a person's click, ends with a `ReportPage` Command
  that answers the waiting call.
- `test/page.test.ts`: the Schema checks, `apply`, a `Story` of an agent's calls through `update`, and a `Scene` of a
  person's click.

Effect UI is in public preview and not on npm yet, so `package.json` pins a pkg.pr.new snapshot by commit
(`@effect/ui@a0d7578`). To move it on: `bun add https://pkg.pr.new/Effect-TS/ui/@effect/ui@<commit>` in this folder.
