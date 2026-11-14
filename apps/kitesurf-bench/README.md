# Kitesurf Bench

> **What it proves:** a `browser` binding is one line of config, and Cloudflare's Kitesurf engine can be measured against Chromium on our own pages, from inside a Worker. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

One Worker with a Browser Run binding and one page. **Run the bench** takes each of our live pages
(eqosys, qCRM, codeSplitter, ShareSplat, the Playground, Hello World, and Skate Tech Park to see what
WebGL does) through three Quick Actions (`content`, `markdown`, `screenshot`). Kitesurf and Chromium
take turns, and the page shows the median time for each, the browser time Cloudflare reports when it
sends one, and any errors. **Copy results** puts the raw runs on the clipboard as JSON.

The times are from inside the Worker, from the call to the last byte. They're not Cloudflare's CPU and
memory figures: those come from inside the engine, and a Worker can't see them.

```sh
bunx rustybuns plan          # a Worker with a browser binding, nothing else
bunx rustybuns deploy        # then open the URL it prints and press Run
bunx rustybuns destroy       # when the numbers are copied
bun test test                # the bench against a stand-in binding
```

The page list is fixed in `src/bench.ts`, so the deployed Worker can't be pointed anywhere else. Each
isolate stops after 600 browser calls. Kitesurf is free in beta. A full run at three turns uses about a
minute of Chromium browser time.
