# Deploy round, 2026-10-29

Built from the 300 most recent merged PRs on `main` (head `193a2a24`). Nothing in the repo records when each app
was last deployed, so this lists what merged since 2026-10-22 per app, not what is stale on Cloudflare.
Cross out anything you deployed after its first PR.

## Deploy first (user-facing change, many PRs)

| App | PRs since 10-22 | Newest | Watch for |
|---|---|---|---|
| codesplitter | 38 | #2862 | `release.ts` (needs `DEPLOYS=1 AGENTS=1 CHECKS=1`, sets `CODESPLITTER_PUSH_EVENTS=1`); Artifacts move by mirror + verify (#2579) |
| skate-tech-park | 41 | #2862 | #2862 renamed the worker; confirm the stage or you get a second copy |
| two-fronts | 54 | #2836 | none known |
| mythic-masters | 34 (as wildclash) | #2860 | renamed from `apps/wildclash` in #2841: a deploy creates a new worker, the old `wildclash` one stays until you decide |
| eqosys | 11 | #2848 | serves on `eqosys.qntbr.com`; GitHub and Google sign-in secrets are left out until their 1Password items exist (#2848); Park Hide & Seek sign-in (#2805) needs it live first |
| park-hide-seek | 17 | #2832 | deploy eqosys before it; use plain wrangler with the notryanquinn account id |
| splat-spray | 5 | #2832 | shared matchmaker (#2825), ships with park-hide-seek |
| fm-daw | 19 | #2793 | none known |
| qcrm | 6 | #2853 | feature tour (#2853) touched codesplitter too |

## Deploy if live

alien-disc-golf (5, #2777), git-recon (16, #2695), hippo-tycoon (7, #2695), delayed-reaction (7, #2604),
terraviz-demo (3, #2745), meshy-studio (3, #2836), artstewengine (3, #2781), excalibrawl (4, #2582),
splat-rooms (3, #2627), geoboxq (3, #2678), at-lens (2, #2677), what-would-fantano-say (2, #2678).

## Not a Cloudflare deploy

- agent-office (38 PRs, #2863): a Bun binary, released on an `agent-office-v*` tag you push.
- auto-rig, splat-desktop, tscircuit-desktop: desktop or library, nothing to deploy.
- `*-example` apps, playground, hello-world: framework try-outs, only touched by the Alchemy/boundary sweeps.
- packages (cli, util, terrain, rig, cms, game-controls, shell-bun): ride along with the apps above.

## Before any of it

- Alchemy is pinned at beta.84; #2246 (the bump WIP) is still open.
- Deploys need the owner's Touch ID and `unset CLOUDFLARE_API_TOKEN`; agents don't run them.
