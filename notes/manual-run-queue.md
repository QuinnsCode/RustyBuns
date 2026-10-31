# Manual run queue (13 Oct 2026)

> **Snapshot of 13 Oct, not current.** Most runs listed here are closed; only #1365, #967 and the #609 roll-up are known open. Use `bun run manual` and `gh issue list --label "manual run"` for the live list (#2956).

Open `manual run` issues, grouped by what you need on the other machine. The long checklist is [#609](https://github.com/QuinnsCode/RustyBuns/issues/609); each issue has its own steps.

## Needs only a browser and your accounts
- [#1261](https://github.com/QuinnsCode/RustyBuns/issues/1261) first signed Mac drop (Apple credentials are in, per its comment)
- [#819](https://github.com/QuinnsCode/RustyBuns/issues/819) restart Agent Office as quinnscode-bot
- [#754](https://github.com/QuinnsCode/RustyBuns/issues/754) agents' own GitHub identity, then require review
- [#798](https://github.com/QuinnsCode/RustyBuns/issues/798) account-level spend caps (Cloudflare, LLM keys, Railway, Actions)

## Needs a real Cloudflare deploy (cents)
- [#825](https://github.com/QuinnsCode/RustyBuns/issues/825) copy codeSplitter data to the `codesplitter` names (`release-codesplitters.sh --move`)
- [#878](https://github.com/QuinnsCode/RustyBuns/issues/878) switch on borg-edge
- [#892](https://github.com/QuinnsCode/RustyBuns/issues/892) tags on a hosted Artifacts repo
- [#916](https://github.com/QuinnsCode/RustyBuns/issues/916) deploy What Would Fantano Say
- [#931](https://github.com/QuinnsCode/RustyBuns/issues/931) rerun the interrupt test with `DELAY=12`
- [#845](https://github.com/QuinnsCode/RustyBuns/issues/845) Astro images on the edge and a box; EmDash on the edge
- [#1204](https://github.com/QuinnsCode/RustyBuns/issues/1204) deploy git-recon battles online
- [#1365](https://github.com/QuinnsCode/RustyBuns/issues/1365) smoke the FRESH/ADOPT guard on a disposable account (not labelled, but needs you)

## Needs a box, a Mac or a LAN
- [#762](https://github.com/QuinnsCode/RustyBuns/issues/762) hosted deploy of an x86 Hetzner box with `native/` crates
- [#1031](https://github.com/QuinnsCode/RustyBuns/issues/1031) codeSplitter checks as a sandbox user on a real Mac
- [#1215](https://github.com/QuinnsCode/RustyBuns/issues/1215) git-recon lag compensation on a real LAN
- [#942](https://github.com/QuinnsCode/RustyBuns/issues/942) Agent Office agent again

## Live agent runs
- [#873](https://github.com/QuinnsCode/RustyBuns/issues/873) dependency doctor's on-fail chain
- [#1135](https://github.com/QuinnsCode/RustyBuns/issues/1135) codex, pi and opencode JSON usage against a live run
- [#967](https://github.com/QuinnsCode/RustyBuns/issues/967) Excalibrawl migration
