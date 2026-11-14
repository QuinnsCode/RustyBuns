# Cron Swanson

Every scheduled thing in one place, by app: the nightly backups, the weekly check-ins, the yearly renewals.
Part alarm, part reminder, part note: each job says when it runs, why it exists, what it calls, and carries
tags. Its engine, **bacron**, ticks on each minute boundary and fires on time to well under a second.

- **Five lanes**: async (every N minutes, one-offs, busy cron lines), daily, weekly, monthly, yearly. Each has a count.
- **Per app and all apps**: the side lists every app; pick one or see them all grouped. Tags and search narrow it down.
- **Plain cadences or cron lines**: "Weekdays at 09:00", "Monthly on the last day", or `*/15 9-17 * * 1-5`. Each runs on
  its own time zone. The 31st in a short month runs on its last day; Feb 29 runs on Feb 28 in other years; a time
  that daylight saving skips runs just after the jump.
- **Reminder or URL**: a job shows up in Recent runs, and can also `GET` or `POST` a URL (with its id, app, name,
  tags and the time it was due).
- **Every device in step**: pages open on the laptop and the phone hold a socket to the server and fetch again the
  moment a job is made, changed or run anywhere. While the socket is down, they fetch just after each minute.
- **Reminders on your phone**: with `CRON_SWANSON_NTFY` set to an [ntfy](https://ntfy.sh) topic URL, a reminder pings
  the phone at its minute (subscribe to the topic in the ntfy app). Each reminder has a "Ping my phone" box; a ping
  ntfy refuses shows as a failed run that says why.
- **Drift you can see**: each run records how far it was off its minute. A job due while the box was down fires
  once when it's back, marked late, and then goes on from now.

## Why a small server and not Durable Object alarms

Alarms were landing up to five minutes late in practice. Cron Swanson is one Bun process with a SQLite file and
a `setTimeout` to the next minute, so its accuracy is the box's clock. It runs on a laptop, under a desk, or on
Railway (one small always-on service; one replica only, or every job fires twice). Device sync rides a
WebSocket on the same process for the same reason: the one server already sees every change, so a Durable
Object relay would add a deploy and a hop without making anything sooner.

## Run it

```sh
cd apps/cron-swanson
bun run dev                 # http://localhost:8790, jobs in data/cron-swanson.sqlite
PORT=8811 CRON_SWANSON_DB=:memory: bun src/main.ts   # a throwaway copy
bun test test
```

| Variable | What it does |
| --- | --- |
| `PORT` | Where it listens (default 8790). |
| `CRON_SWANSON_DB` | The SQLite file (default `data/cron-swanson.sqlite`; the Dockerfile uses `/data/...` for a volume). |
| `CRON_SWANSON_TOKEN` | When set, every route but `/api/health` wants `Authorization: Bearer <token>`. The page asks for it once. |
| `CRON_SWANSON_NTFY` | An ntfy topic URL reminders ping, like `https://ntfy.sh/<a long random topic>` (anyone who knows a topic on ntfy.sh can read it) or one on your own ntfy server. |
| `CRON_SWANSON_NTFY_TOKEN` | The access token, if that ntfy server wants one. |

## Railway

`railway.json` builds `Dockerfile` from the repo root. Give the service a volume at `/data` and a
`CRON_SWANSON_TOKEN` (and `CRON_SWANSON_NTFY` for phone pings), and keep it at one replica.

## API

| Route | Does |
| --- | --- |
| `GET /api/health` | `{ ok, now }`, open without a token. |
| `GET /api/jobs` | Every job with its last run, the latest 100 runs, and the server's clock. |
| `POST /api/jobs` | Makes a job: `{ app, name, why?, note?, tags, cadence, tz, action, enabled? }`. |
| `PUT /api/jobs/:id` | Changes one (same body). A new cadence restarts its "every" count. |
| `DELETE /api/jobs/:id` | Deletes it and its runs. |
| `POST /api/jobs/:id/run` | Fires it now, logged as by hand. |
| `GET /api/jobs/:id/runs` | Its last runs (`?limit=`, up to 200). |
| `GET /api/live` | A WebSocket: `{ kind: "changed", at }` after any change. Offer the subprotocols `cron-swanson` and `bearer.<token as b64url>`. |

A cadence is one of `{ kind: "once", at: "2026-11-20T09:00" }`, `{ kind: "every", minutes }`,
`{ kind: "daily", time: "09:00" }`, `{ kind: "weekly", time, days: [1,2,3,4,5] }` (0 is Sunday),
`{ kind: "monthly", time, day }` (`-1` is the last day), `{ kind: "yearly", time, month, day }` or
`{ kind: "cron", expr }`. An action is `{ kind: "remind", ping? }` (`ping` defaults to true) or `{ kind: "webhook", url, method: "POST" | "GET" }`.

## Files

- `src/bacron.ts`: the engine. Cadences, next run on a wall clock, cron lines, lanes, plain words. No clock, no storage.
- `src/ticker.ts`: fires what's due each minute, books the next run first, calls URLs.
- `src/store.ts`: SQLite, which says when it changed. `src/server.ts`: the API and the live socket. `src/api.ts`: the wire shapes both sides check.
- `src/page.*`: the page, bundled by Bun from the HTML import in `src/main.ts`.
