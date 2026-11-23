# Cron Swanson

Every scheduled thing in one place, by app: the nightly backups, the weekly check-ins, the yearly renewals.
Part alarm, part reminder, part note: each job says when it runs, why it exists, what it calls, and carries
tags. Its engine, **bacron**, ticks on each minute boundary and fires on time to well under a second.

## Use it

**What it is:** your alarms and reminders in one place, there to pester you: water, sweeps, rent, the furnace filter.
It also holds the jobs that run on a timer for other apps (nightly backups, weekly check-ins, yearly renewals).

**Use:** not online right now. Run it yourself: `bun install --frozen-lockfile` at the repo root, then `cd apps/cron-swanson && bun run dev` and open http://localhost:8790.

**How to use:** type what to nag you about in the big box up top, tap when (in 15 min, tonight, tomorrow 9 am, or
any time up to three months out) and how often (once, every 15 min, every hour, every day, weekdays, every week,
every month), and press Add alarm. More options opens the full editor (cron lines, URLs, tags, time zones).
Below it, Coming up shows each alarm as glowing notes across the next 6 hours, day, week, month or three months; a
playhead sweeps across, and with the speaker on, each note it passes plays an 808. Click a row to edit that alarm.
When a reminder goes off it lands as a card on the right: Done ticks it off, 10 min or 1 hour snoozes it (it comes
back then). The bell turns on desktop alerts, the sun/moon/screen button picks light, dark or the system's look.
All alarms, further down, sorts by next up, shortest interval, done most, fired most, ignored most or idle longest.

**Account:** your eqosys account. Online, the page sends you to eqosys to sign in and comes back signed in; only the
account named in `CRON_SWANSON_OWNER` gets in (anyone else is asked to switch accounts). Run on your own machine with
neither `CRON_SWANSON_OWNER` nor `CRON_SWANSON_TOKEN` set, it's open and asks nothing.

- **Five lanes**: async (every N minutes, one-offs, busy cron lines), daily, weekly, monthly, yearly. Each has a count.
- **Per app and all apps**: chips over All alarms pick one app or show them all grouped. Tags and search narrow it down.
- **Plain cadences or cron lines**: "Weekdays at 09:00", "Monthly on the last day", or `*/15 9-17 * * 1-5`. Each runs on
  its own time zone. The 31st in a short month runs on its last day; Feb 29 runs on Feb 28 in other years; a time
  that daylight saving skips runs just after the jump.
- **Reminder or URL**: a reminder lands as a card on the right, and can also `GET` or `POST` a URL (with its id, app, name,
  tags and the time it was due).
- **Each app lists its own**: a `cron-swanson.json` in the app folder, sent with one call; Cloudflare cron triggers
  in its wrangler config come along and sit in their lanes too (Cloudflare runs those, so they log no runs here).
- **Live on every device**: with the relay set up, a page open on the laptop and one on the phone both show a new
  job or a run the moment it happens. Without it, pages fetch again just after each minute.
- **Reminders that reach you**: with an [ntfy](https://ntfy.sh) topic set, a reminder pings the phone at its minute
  (its app and name as the title, its why or note as the text). A push that fails says so on the run.
- **Done, snoozed or ignored**: tick a reminder off on its card or its row, or snooze it (it comes back as a card
  when the snooze ends). One left unticked for an hour, or until its job fires again, and not snoozed, counts as ignored. Each job shows how often it fired, was done and was ignored (over its
  last 200 runs), and the order menu sorts by those, or by how long since it was last any use.
- **Desktop alerts**: the bell asks the browser for notifications; then each new reminder pops up on this computer
  while a Cron Swanson tab is open (ntfy, below, covers the phone and a closed laptop).
- **Drift you can see**: each run records how far it was off its minute. A job due while the box was down fires
  once when it's back, marked late, and then goes on from now.

## Why a small server and not Durable Object alarms

Alarms were landing up to five minutes late in practice. Cron Swanson is one Bun process with a SQLite file and
a `setTimeout` to the next minute, so its accuracy is the box's clock. It runs on a laptop, under a desk, or on
Railway (one small always-on service; one replica only, or every job fires twice).

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
| `CRON_SWANSON_OWNER` | The email of the one eqosys account the page lets in. The page signs in through eqosys and sends its token; the server checks it against eqosys's keys (`@rustybuns/util/token`). |
| `EQOSYS_URL` | Which eqosys signs people in (default `https://eqosys.qntbr.com`). A page signs in against a local one with `localStorage["cron-swanson.eqosys"] = "http://localhost:<port>"`. |
| `CRON_SWANSON_TOKEN` | The bearer for scripts and apps (`src/sync.ts`): `Authorization: Bearer <token>`. Also the relay's secret. With neither this nor `CRON_SWANSON_OWNER` set, the API is open. |
| `CRON_SWANSON_RELAY` | The relay Worker's URL (`https://cron-swanson-relay.<you>.workers.dev`). The server nudges it after each change; pages hold a socket to it. |
| `CRON_SWANSON_NTFY` | An ntfy topic URL (`https://ntfy.sh/<a long random name>`). Each reminder is pushed there. Anyone who knows the name can read the topic, so make it long. |

## Live pages: the relay

`src/relay.ts` is a Cloudflare Worker with one Durable Object that only fans out: the server POSTs `/publish` after
a job changes or a run lands, and every page's socket hears `{ t: "changed" }` and fetches `/api/jobs` again. It
stores nothing and keeps no clock; the Bun server stays the clock, since Durable Object alarms landed minutes late.
The socket hibernates between nudges, so an idle page costs next to nothing.

1. `cd apps/cron-swanson/relay && bunx wrangler deploy`
2. Give the Worker a `TOKEN` secret equal to `CRON_SWANSON_TOKEN`. The server sends it as a bearer; a signed-in page
   never sees it, and offers the day's ticket `/api/jobs` hands it instead (signed with the token, good until the end of tomorrow).
3. Set `CRON_SWANSON_RELAY` on the server to the Worker's URL and restart it.

## Reminders on the phone: ntfy

Install the ntfy app, subscribe to a topic with a long random name, and set `CRON_SWANSON_NTFY` to
`https://ntfy.sh/<that name>` (or your own ntfy server's URL).

## Railway

`railway.json` builds `Dockerfile` from the repo root. The image installs only this app's packages (one, plus the
repo's own `packages/`), not the whole repo's 4 GB.

1. New service from this GitHub repo. Leave **Root Directory** empty: the Dockerfile copies the whole repo.
2. Settings, **Config-as-code**, Railway Config File: `/apps/cron-swanson/railway.json`. Railway only reads the
   root's `railway.json` on its own, so without this it never finds the Dockerfile or the health check.
3. A volume mounted at `/data` (jobs and runs live in `/data/cron-swanson.sqlite`).
4. The variables `CRON_SWANSON_OWNER` (your eqosys email) and `CRON_SWANSON_TOKEN` (a long random string, for
   scripts and the relay). Keep **one replica**: two would fire every job twice.
5. Settings, Networking, **Generate Domain**.
6. Put that domain in Cron Swanson's row in eqosys's `APPS` (`apps/eqosys/src/apps.ts`, `origins`) in a PR and deploy
   eqosys, so eqosys sends you back there after you sign in. Then open the domain and sign in.

## API

| Route | Does |
| --- | --- |
| `GET /api/health` | `{ ok, now }`, open without a token. |
| `GET /api/jobs` | Every job with its last run and its `stats` (`fired`, `done`, `ignored`, `lastDoneAt`, `lastFiredAt`), the latest 100 runs, the server's clock, `live`: the relay's socket URL or null, and `ticket`: the day's pass onto it or null. |

Every route but health wants `Authorization: Bearer <...>`: the owner's eqosys token or `CRON_SWANSON_TOKEN`. A 401 says
`sign in with eqosys` (no token, or one that doesn't check out) or `not the owner's account`.
| `POST /api/jobs` | Makes a job: `{ app, name, why?, note?, tags, cadence, tz, action, enabled? }`. |
| `PUT /api/jobs/:id` | Changes one (same body). A new cadence restarts its "every" count. |
| `DELETE /api/jobs/:id` | Deletes it and its runs. |
| `POST /api/jobs/:id/run` | Fires it now, logged as by hand. |
| `POST /api/runs/:id/done` | Ticks a reminder off (`doneAt`); a second tick keeps the first time. |
| `POST /api/runs/:id/snooze` | Puts a reminder off: `{ minutes }`, 1 to 1440 (`snoozedUntil`). |
| `GET /api/jobs/:id/runs` | Its last runs (`?limit=`, up to 200). |
| `PUT /api/apps/:app/jobs` | Matches the app's listed jobs to `{ jobs: [{ key, name, cadence, tz, tags, action, why?, note? }] }`: new keys added, changed ones updated, missing ones deleted. Jobs made by hand, and pauses made on the page, stay. Says `{ added, changed, removed, same }`. |

A cadence is one of `{ kind: "once", at: "2026-11-20T09:00" }`, `{ kind: "every", minutes }`,
`{ kind: "daily", time: "09:00" }`, `{ kind: "weekly", time, days: [1,2,3,4,5] }` (0 is Sunday),
`{ kind: "monthly", time, day }` (`-1` is the last day), `{ kind: "yearly", time, month, day }` or
`{ kind: "cron", expr }`. An action is `{ kind: "remind" }`, `{ kind: "webhook", url, method: "POST" | "GET" }` or `{ kind: "elsewhere", by }`
(something else runs it; it shows its next run and logs none).

## An app's own jobs

Put a `cron-swanson.json` in the app's folder (comments are fine) and send it:

```jsonc
{
  "app": "qcrm", // optional: the folder's name otherwise
  "jobs": [
    { "key": "backup", "name": "Back up the CRM", "why": "In case D1 eats itself", "cadence": { "kind": "daily", "time": "09:00" },
      "tags": ["ops"], "tz": "UTC", "action": { "kind": "webhook", "url": "https://qcrm.example.com/api/cron/backup" } }
  ]
}
```

```sh
CRON_SWANSON_URL=https://cron.example.com CRON_SWANSON_TOKEN=... bun apps/cron-swanson/src/sync.ts apps/qcrm apps/eqosys
```

`tags`, `tz` (UTC) and `action` (a reminder) may be left out. A key is the job's name in the file: keep it when
you rename a job and it stays the same job, with its runs. The app's `wrangler.jsonc`, `.json` or `.toml` cron
triggers come in as "Cloudflare cron trigger" jobs keyed by their line.

## Files

- `src/bacron.ts`: the engine. Cadences, next run on a wall clock, cron lines, lanes, plain words. No clock, no storage.
- `src/ticker.ts`: fires what's due each minute, books the next run first, calls URLs.
- `src/sync.ts`: reads an app folder's own list and wrangler crons and sends them.
- `src/store.ts`: SQLite. `src/server.ts`: the API. `src/api.ts`: the wire shapes both sides check.
- `src/page.*`: the page, bundled by Bun from the HTML import in `src/main.ts`. `src/quick.ts`: the big add (when and how often to a cadence, three months at most). `src/roll.ts`: Coming up, the notes and the playhead. `src/boom.ts`: the 808. `src/yule.ts`: the pixel fire.
