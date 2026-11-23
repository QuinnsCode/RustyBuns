# Copy Desk

> **What it proves:** a business can run its own site's words on Rusty Buns' built-in CMS (`packages/cms`). A bakery's
> one-page site, where the hero, the hours, the news posts and the footer are all `content/*.json`, edited as forms and
> translated into `content/es/`. Listed under **Business** on eqosys (coming soon until its first deploy). One of the
> [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Use it

```
cd apps/copy-desk
bun run dev     # the site, at the port Vite prints; ?lang=es for Spanish
bun run cms     # the editor, at http://localhost:4707
```

In the editor, pick `site` or `posts`, change a line, save, and reload the site.

- **News posts** are `content/posts.json`. A post shows when its `published` is 1; set it to 0 to keep it as a draft.
  The newest date comes first.
- **Languages:** the editor's front page adds one (`fr`, `pt-BR`) and shows each line's original under its box. A blank
  line reads in English, and dates and `published` always come from the English file.
- The editor listens only on `127.0.0.1` and can change words, never add or remove a key, so the page can't break.

## How it works

`src/main.ts` imports the two JSON files, picks the language once at boot (`localizeContent` from
`@rustybuns/cms/locale`), and builds the page from them. `src/site.ts` is which posts show. `window.copyDesk.state()`
gives the language, the brand and the posts shown.

## Deploy

`bun run deploy` builds the page and ships it as static assets (`wrangler.jsonc`). Once it is live, drop `soon` from its
`APPS` row in `apps/eqosys/src/apps.ts` so the eqosys card links to it.

Not in this first cut: sign-in through eqosys for editing on the live site, a rich text editor, image uploads, and
drafts with a preview.
