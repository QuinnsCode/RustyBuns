# brianfloresblitzing

> **What it proves:** a single static page (`public/index.html`, "One Team in 32") served from a Cloudflare Worker as plain assets, no Worker code. One of the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Run it

```
cd apps/brianfloresblitzing
bun run dev              # local preview
bun run deploy           # ship it as the Worker "brianfloresblitzing"
```

Edit `public/index.html` and deploy again to change the page.
