# agent-demo: Snack Vote

A small Worker that counts snack votes, built to be handed to several coding agents at once on
[codeSplitter](../codesplitter). `bun seed.ts` loads it into a fresh codeSplitter repo, with a
branch whose merge has one conflict to settle on camera, and prints the prompts for three agents.
[DEMO.md](DEMO.md) is the recording script.

```sh
codesplitter login        # once: the site and a token from your profile page
bun seed.ts                # or --url URL --token cst_…, --name my-demo
bun test test
```

It's a RustyBuns app too: `rustybuns deploy` ships it to Cloudflare as is.
