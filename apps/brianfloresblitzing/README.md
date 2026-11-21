# brianfloresblitzing

> **What it proves:** a single static page (`public/index.html`, "One Team in 32") served from a Cloudflare Worker as plain assets, no Worker code. One of the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

**Live:** https://brianfloresblitzing.notryanquinn.workers.dev · on [eqosys](https://eqosys.qntbr.com)

## Use it

**What it is:** one page about American football: how one team that blitzes a lot pulls the whole league's average up.

**Use:** https://brianfloresblitzing.notryanquinn.workers.dev

**How to use:** read down the page, then drag the slider and watch the gold line (the league average) move.

**Account:** not needed.

## Run it

```
cd apps/brianfloresblitzing
bun run dev              # local preview
bun run deploy           # ship it as the Worker "brianfloresblitzing"
```

Edit `public/index.html` and deploy again to change the page.
