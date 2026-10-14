# codeSplitter watchdog

A cron Worker, separate from the app, that rolls codeSplitter back when a bad deploy takes it down (#1562).

- Every minute it calls `GET /api/health` (200 only if the app answers and reads its database).
- A version that answers while live is remembered as good. A version that fails is forgotten.
- After 3 failed checks in a row (`FAILS`) it puts the newest good version on 100% of the traffic through the Workers API. It never touches the deploy path.
- Once the app answers again it posts the rollback to `POST /api/watchdog/rolled-back`, which sends a failed `deploy.finished` hook event to `REPORT_REPO`.

The owner deploys it: create a KV namespace for `STATE` and put its id in `wrangler.jsonc`, fill in the vars, store `CF_API_TOKEN` (Workers Scripts edit) and `WATCHDOG_SECRET` (the same value as the app's `WATCHDOG_SECRET`) as Worker secrets, then deploy. Agents never fetch those values.
