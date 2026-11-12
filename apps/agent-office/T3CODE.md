# T3 Code beside the office: your phone, your Mac, your agents

How to start and steer coding agents on this repo from your phone with [T3 Code](https://github.com/pingdotgg/t3code)'s
mobile app, while one Mac stays on at home. Read-only on T3 Code: we use their releases and never send them PRs or issues.

## The short answer

- **No box.** "Box" means two things here and you need neither. `rustybuns deploy` to a `box` target puts an *app* on
  Railway or Hetzner ([GETTING_STARTED.md](../../GETTING_STARTED.md#4-a-server-a-box)), and `office:box` runs the
  *office* in Docker ([SANDBOX.md](SANDBOX.md)) to fence it in. T3 Code runs straight on the Mac, where your `claude`
  login, `gh`, Xcode and the repo already are.
- **Yes, it's still Claude Code.** T3 Code doesn't sell tokens or run its own model. It drives the agent CLIs you've
  signed in to on that Mac (`claude`, `codex`, Cursor, Grok, Muse and more), so a thread started from the phone is a
  `claude` session on your subscription, reading this repo's `CLAUDE.md` / `AGENTS.md` like any other.
- **Tailscale, not T3 Connect.** Tailscale is already in [MAC_SETUP.md](../../MAC_SETUP.md) and `office:phone` uses it.
  T3 Connect is T3's own relay: another account, a third party in the path, 3 machines on the free tier.

## Your options

| | What runs on the Mac | From the phone | Setup | Good for |
|---|---|---|---|---|
| **A. Office only** (works today) | `bun run office` | `/lite` in the browser via `bun run office:phone`: every worker, its terminal, ✨ New task, issues and PRs | none | managing several workers at once |
| **B. T3 Code only** | `t3 up` (background service) | T3's iOS/Android app | 10 min | one chat-style thread at a time, nice mobile UI |
| **C. Both, side by side** (recommended) | office + `t3 up` | T3 app for quick threads, `/lite` for the floor | 10 min, plus the port fix below | the daily mix |
| **D. T3 hires office workers** | C, plus a bridge | ask a T3 thread "hire a worker for #123" | needs work, see below | one phone app for everything |
| **E. T3 as an office worker type** | | | large: T3 is itself a control plane, not an agent CLI | not worth it |

## Setting up C

On the Mac that stays on (the office Mac, or Bob if you'd rather the agents run there):

```sh
brew install --cask t3-code          # or: curl -fsSL https://t3.codes/install.sh | sh
claude auth login                    # already done if the office's Claude workers run here
t3 up                                # installs it as a background service; pick "Tailscale", not T3 Connect
t3 serve --tailscale-serve --tailscale-serve-port 8443   # if you run it by hand instead of t3 up
t3 pair --tailscale                  # prints a one-time link and QR code
```

Then on the phone: Tailscale signed in to the same tailnet, the T3 Code app, **Settings → Environments → Add
environment**, scan the QR code. The link looks like `https://<mac>.<tailnet>.ts.net:8443/`.

**The port clash.** `office:phone` serves the office on the tailnet's port 443, and T3's `--tailscale-serve` wants 443
too: whichever runs second takes the office's link over. Give T3 another port (`--tailscale-serve-port 8443`, as above)
and both live on the same Mac name.

**Keep the Mac awake.** System Settings › Energy: "Prevent automatic sleeping when the display is off" on. `t3 up` installs a background service that comes back after a reboot; the office does only if you
set it to start at login.

## What T3 threads don't get

A T3 thread is a plain `claude` session, not an office worker, so:

- **The repo's guard still applies.** `.claude/settings.json` (deny-list) and `.claude/hooks/guard.ts` load for any
  Claude Code session in this repo, T3's included.
- **The ✋ GitHub-writes card doesn't.** That hook ([`askfirst/`](askfirst)) is patched into office workers' settings
  only, so a T3 thread can push or comment without asking. `main` is still protected by the ruleset.
- **It isn't on the floor.** No desk, no storage cap, no `office-workers` (its commands sign with the worker's own token,
  `AGENT_OFFICE_HOOK_TOKEN`, so from a T3 thread they answer 401).
- **Where it works.** Point T3 at a worktree of its own, never at the office's floor or at
  `~/Documents/projects/RustyBuns`, so it doesn't edit under a worker or your own checkout.

## Option D: what it would take

The missing piece is a way in for someone who isn't a worker: an owner token (made in **☰ → 🔑 Accounts**, scoped to
list / hire / tell) that `office-workers` reads when it isn't in a worker's terminal. Then a T3 thread runs
`office-workers hire --issue 123` and the worker shows up on the floor and in `/lite` like any other.

## Safety

- Pairing links and codes are passwords: one fresh link per device (`t3 pair`), and revoke a lost phone with
  `t3 auth session list` / `t3 auth session revoke <id>`.
- Don't use `t3 serve --lan`: on the LAN the pairing code is the only lock. Tailscale adds the network as a second one.
- A token made without `--scope` can do everything, including managing access. For a second device that only watches:
  `t3 pair --tailscale --scope orchestration:read --scope relay:read`.
