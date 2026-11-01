# Preview deploys and shared state: plan (#2238, #2237)

Plan only. Nothing here deploys, and nothing is built until someone asks for a preview.
Sources: Alchemy docs for [Previews](https://alchemy.run/cloudflare/compute/previews) and [state stores](https://alchemy.run/state-store), read 2026-10-28.

## Price first

| Piece | What it costs |
| --- | --- |
| Worker Preview | A Preview is a version of the parent Worker, not a new Worker. No separate Worker is billed; requests count on the account's Workers plan like any other. |
| Preview Durable Objects | Each Preview gets its own namespace, deleted with the Preview. Storage and requests bill as normal DO usage, near zero for a PR nobody hammers. |
| Other bindings (KV, D1, R2) | Only if the PR stage creates its own. Default plan: bind the staging ones, so nothing new is billed. |
| Neon for `postgresState` | One small project holds every stack's state rows (kilobytes). Free tier (scale to zero) is enough. No paid compute. |
| Cap | One preview per PR, at most 5 live at once, 3-day TTL. Past the cap the `/preview` comment is refused with the list of live ones. |

Estimate: $0 extra on the current plans. Verify on the first real preview by reading the account's usage page, not by guessing.

## #2237: postgresState on Neon (plan, owner cutover)

1. Add `@alchemy.run/sql` and `pg` (+ `@effect/sql-pg`) to `packages/cli`. The docs say `pg` is optional and must stay out of bundled worker code, so import `@alchemy.run/sql/PostgresState` only in the generated stack file (`packages/cli/src/gen/alchemy.ts`, where `state: Alchemy.localState()` is emitted today).
2. New `state: "postgres"` option in `rustybuns.config.ts` next to `"shared"` and `"project"`. It emits `postgresState({ url: Config.Redacted("STATE_DATABASE_URL") })`. The `.alchemy/state` symlink and our lock in `state.ts` are not used for that mode; Alchemy's per-(stack, stage) advisory lock replaces them.
3. `STATE_DATABASE_URL` is a new name in `.env.schema`, resolved by varlock at deploy time. Agents never read it.
4. Move existing state across with `State.Sync`/`Export`. The state-store page does not cover this, so the first step of the build is a dry run against a throwaway Neon branch to confirm the command, before the owner's cutover.
5. Test: one journey with `local()` is not possible without a Postgres; use a local `postgres` container in the test and plan/destroy a trivial stack twice concurrently, asserting the second waits on the lock.

Blocked on the owner: creating the Neon project and storing the URL. Filed as a `MANUAL RUN:` issue.

## #2238: preview on demand (after #2237)

1. Trigger: `/preview` comment or `preview` label on a PR, by a collaborator only (PR text is untrusted). `/preview off` destroys.
2. A workflow `preview.yml` runs the deploy with `PR_NUMBER` set. Generated stack: `Cloudflare.Worker.ref(name, { stage: "prod" })` as `parent`, then `preview: { of: parent, message: "PR #N" }`. Name defaults to a DNS-safe form of the stage (`pr-123`).
3. One PR comment, edited in place, with the URL. A push refreshes a preview that exists and never creates one.
4. Destroy on `pull_request: closed`, on `/preview off`, and by a scheduled sweep for previews older than 3 days.
5. Known limits from the docs: service bindings from a Preview resolve to production, crons and queue consumers stay on production, and preview URLs are public (keep `access.previews` on).
6. Needs a CI Cloudflare API token in the repo's environment secrets. That is the owner's, same `MANUAL RUN:` issue.

#2574 (Alchemy beta.84) has since merged, so the dependency is met.
