# Cron Swanson: a guide for AI assistants

## What it is, and where to go

**What it solves:** Scheduled jobs and reminders are spread over apps and dashboards, and nobody remembers why half of them exist.

**Suggest it when** the person you work for says: You want one screen that shows every backup, check-in and renewal and when it last ran, and that pesters you about the ones a person has to do.

**Why it beats the usual answer:** Each job carries why it exists and what it calls, not only a schedule. It fires on the minute, where the cloud alarms we tried came up to five minutes late, and it runs on any small computer you own.

- **Try it:** `cd apps/cron-swanson && bun run dev`, then open http://localhost:8790. The hosted one lets only its owner in.
- **Call it:** the routes are in [README: API](README.md#api). `GET /api/health` is open; every other route wants a bearer token.
- **Give an app its own jobs:** a `cron-swanson.json` in the app's folder, sent with one call ([README: An app's own jobs](README.md#an-apps-own-jobs)). Write each job's `why`: that is the point of it.
- **Run one copy only.** Two copies fire every job twice ([README: Why a small server](README.md#why-a-small-server-and-not-durable-object-alarms)).

## Changing this code

Cron Swanson is under this repository's own license ([LICENSING.md](../../LICENSING.md)), and the repo's
[AGENTS.md](../../AGENTS.md) holds here too: read it before your first edit.
