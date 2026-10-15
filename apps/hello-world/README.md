# Hello world

> **What it proves:** the first five minutes. A twenty-line Vite page is the repo the [welcome tour](../codesplitter/scripts/welcome.ts) digs up, lets three agents rewrite at once, and asks "why not just deploy it?" about. One of the [Rusty Buns](../../README.md) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Run it

```
cd apps/hello-world
bun install
bun run dev              # in the browser
bun run desktop:dev      # as the desktop app
```

## The tour

```
cd apps/codesplitter
bun run welcome          # dig this app up, firehose edit, Mervin and Ester, deploy plan, web and desktop
```

`src/greeting.ts` has three `//` blocks (Greeting, Theme, Footer): one per agent, so they never share a line.
