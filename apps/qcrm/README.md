# qCRM

The CRM your agents can use. Contacts, companies, deals and activities for a real place of business,
with an MCP server built in, a Rust engine for analysis in the browser, office sync, signed webhooks,
a desktop build, and every row yours to export or delete. One Cloudflare Worker, one D1 database.

Licensed under the QNTBR "This Shit Mine" license ([LICENSE](LICENSE)): read it, run it to evaluate
it, send fixes; don't copy, resell or host it for others. The rest of this repository stays under its
own license.

## Run it

```sh
bun install --frozen-lockfile        # at the repo root, once
cd apps/qcrm
bun run dev                          # http://localhost:5173, in-memory everything
bun test test                        # the whole journey, in-process
bun run seed                         # 100,000 contacts into a fresh org; prints the timing
bun run wasm                         # rebuild the checked-in Rust engine
bun run seal                         # encrypt the engine for release (needs ENGINE_KEY through varlock)
bun run deploy                       # Cloudflare, with DEPLOYS=1 and secrets through varlock (.env.schema)
bun run desktop:build                # the desktop app: same Worker on Bun with sqlite, data in ~/.qcrm
                                     # (127.0.0.1 only; sessions are signed with a random secret kept in its database)
```

qCRM is accounts only: there is no alias mode. `vite dev` reads `BETTER_AUTH_SECRET` from
`wrangler.jsonc`'s dev vars (a throwaway string, generated); production gets the real one through varlock.

## Jump to the state

On a local run (dev server, desktop, tests; a deployment answers 404) each link makes a throwaway account,
signs it in and lands on a populated workspace: 300 contacts with five soft-deleted, the three example
scripts, a webhook with an ok, a waiting and a dead delivery, and a manager, an employee and a seasonal member.

| Link | Lands on |
| --- | --- |
| `/app?scenario=populated` | Contacts |
| `/app?scenario=deleted` | Settings, where "Export every row" and "include deleted rows" are |
| `/app?scenario=webhooks` | Settings, webhook deliveries (open the arrow) and Replay |
| `/app?scenario=members` | Settings, the member list |
| `/app?scenario=contact` | Contacts, with one contact open in its sheet |
| `/app?scenario=scripts` | Scripts |
| `/app?scenario=empty` | a new org with nothing in it |

Agents and scripts: `POST /api/scenario {"name": "webhooks"}` (`GET /api/scenario` lists them), or in the page
`await window.qcrm.scenario("webhooks")` and `window.qcrm.goto("scripts")`. Any row of a signed-in workspace opens from `/app?entity=contacts&id=<id>` or `window.qcrm.open("contacts", id)`. The orgs are plan `demo`: the hourly sweep removes them a day later.

## What's in it

| Piece | Where | Notes |
| --- | --- | --- |
| Accounts | `src/auth.ts` | Better Auth on D1. Email and password; GitHub and Google when their keys are set. API keys (`qk_…`, hashed at rest) for agents. |
| Orgs | `src/orgs.ts` | An org id is `org_` + a hash of the owner's account id and the server secret. No subdomains, nothing to enumerate. |
| Roles | `src/rbac.ts` | `seasonal < employee < manager < owner < admin < super_admin`, one `can(role, action)` table. `super_admin` is the account named by `SUPER_ADMIN_EMAIL`: admin in every org and never stored as a member. |
| CRUD | `src/crm.ts` | Four entities, one generic helper, keyset paging, `?q=` search, soft delete. Every query carries `org_id`. |
| Sync engine | `src/sync.ts` | Every write appends to `changes`. `GET …/sync?since=N` replays; `POST …/sync` applies client ops and names conflicts. |
| Webhooks | `src/webhooks.ts` | HMAC-SHA256 signed, queued, retried with backoff for a day, every delivery on record. |
| Scripts | `src/scripts.ts` | Stored async functions an org runs by hand, from the API or from an agent (`run_script`). Each run is a dynamic Worker with no network and one binding back to the org's API, scoped to the caller's role, 200 calls and 10 s. Three examples install in a click. The desktop twin runs them in-process, not sandboxed. |
| Insights | `src/insights.ts` | Cheap SQL aggregates: counts, pipeline by stage, win rate, activity per week. |
| Rust engine | `wasm/`, `src/engine.ts` | Dedupe (Jaro-Winkler and friends), weighted forecast, stale-deal sweep, and the hero wave. Compiled to wasm and checked in (`bun run wasm` rebuilds). |
| MCP | `src/openapi.ts`, `src/mcp.ts` | One tool per API operation, generated from the OpenAPI spec. Risky ones are flagged so an agent asks first. |
| Demo | `src/demo.ts`, `/demo` | The site inside the site: a throwaway org with 2,000 contacts in a frame, swept after 24 h. |
| Tour | `src/app/tour.ts`, `src/features/` | Spotlight steps across the home page, the demo and the app: one JSON file per step and `order.txt` for the order, read by codeSplitter's loader (`@rustybuns/util/features`). `?tour=1` or the button. |
| Privacy | `src/me.ts`, `/privacy` | `GET …/export` gives an owner every row; `DELETE /api/me` removes an account and its orgs. |
| Seed | `src/seed-data.ts`, `scripts/seed.ts` | Deterministic fake rows, 100,000 contacts in one run. |
| CSV import | `src/csv-import.ts` | `POST …/contacts/import` and `…/companies/import`: header mapping, rows already in the org or earlier in the file skipped as duplicates. A drop zone on each table. |
| Command menu | `src/app/commands.ts` | Ctrl/Cmd-K lists everything the signed-in person can do (go to a page, new contact/company/deal/activity, theme, switch org, sign out). The same registry is on the page as `window.crmCommands.list()` and `.run(id, args)`, so scripts, agents and end-to-end tests drive the app without clicking. |

## Connect an agent

An owner makes a key under Settings, then:

```sh
claude mcp add --transport http qcrm https://qcrm.qntbr.com/api/mcp --header "Authorization: Bearer qk_…"
```

Or leave the header off: `claude mcp add --transport http qcrm https://qcrm.qntbr.com/api/mcp`, then `/mcp` in
Claude Code (or Add custom connector in Claude's desktop app) opens a qCRM page where you pick an org and say yes
(OAuth 2.1 with PKCE, `src/oauth.ts`). The token lasts an hour and refreshes; end it under `GET/DELETE /api/oauth/grants`.

`GET /api/mcp` describes the same. OpenAI and others follow the same spec when their MCP clients land.

## Look

Light: sky blue on navy on a warm cream, never white-white. Dark: the darkest purple on black with the
same cream text. Hairlines, 8 px radii, tabular numbers, one accent. Lucide icons, no emoji. Settings
has the switch; it follows the system otherwise.

## Security notes

- Cookie-authenticated writes check the `origin` header against `BETTER_AUTH_URL`.
- Account email is opt-in: deploy with `QCRM_MAIL_FROM=accounts@your-domain` (a sender onboarded to Cloudflare Email Sending) and sign-up sends a verification link while the sign-in page offers "Forgot password?". Without it neither is offered to work; sign-in is not gated on verification.
- A row in another org is a 404, never a 403, so ids don't leak what exists.
- `/api/*` answers are `cache-control: no-store`; pages are cached at the edge for a minute.
- CSP allows `wasm-unsafe-eval` for the engine and nothing off-origin. `/demo` frames `/app`, so `frame-ancestors 'self'`.
- Webhook URLs must be https and never a private IP literal. Deliveries are signed.
- Nothing logs an email or a row.
