# 🐳 Agent Office in a box

Agent Office runs shells and coding agents as you. Run it in a container instead and it can only touch what you
list: the repos you mount, the variables you pass in, the one port you publish. `office:box` reads that list (a
**permission set**), turns it into a `docker run`, and shows you what's granted and whether the box is healthy.

```sh
cd apps/agent-office
cp sandbox/box.example.json sandbox/box.json   # then edit it: your repos, your keys
bun run office:box plan      # print the docker command, run nothing: read it first
bun run office:box up        # build the image once, start the box, print the link and a fresh password
bun run office:box status    # what's granted, container health, whether the port answers
bun run office:box logs      # follow the log
bun run office:box down      # remove the box; the home volume (logins, the office's data) stays
```

## The permission set

`sandbox/box.json` (ignored by git; `box.example.json` is the template):

| Field | Default | What it grants |
|---|---|---|
| `repos` | none | `{ "path": "~/projects/app", "access": "rw" \| "ro" }`: each shows up at `/work/<folder name>`. `ro` is the default, so write access is something you type. The first `rw` repo is the office's floor (it keeps its data in that repo's `.agent-office`, so git-ignore that folder); the rest are there for the agents to read or edit. With no `rw` repo there is no floor: add projects from the elevator, cloned into the box's volume. |
| `env` | none | Variable names to pass in from your shell, e.g. `["ANTHROPIC_API_KEY"]`. Only the name goes on the command line; the value never does. The office also keeps secret-looking names from its workers ([`live/env.ts`](live/env.ts)). |
| `port` | `4600` | Published on your machine's `127.0.0.1` only, never the LAN. Reach it from a phone with [`office:phone`](README.md#-from-your-phone). |
| `network` | `allowlist` | `allowlist`: the box has no route out except an egress proxy beside it, which tunnels HTTPS only to the hosts in `allow`. `open` reaches the whole internet. `offline` cuts the network and publishes no port (for reading code you don't trust). |
| `allow` | model API, GitHub, npm | Hosts for `allowlist` (`registry.npmjs.org`, or `*.example.com` for subdomains). Add your own registry here; `office:box status` and the Box page list them. |
| `ask` | `true` | With `allowlist`: a host not in `allow` waits for an Allow / Deny card in the office (the same card as an agent's request; **Always** on it adds the host to `allow`, so it isn't asked again) instead of being refused; no answer in two minutes is a no. Hosts on the list go through and are only logged. |
| `log` | `{ "maxMb": 10, "keepDays": 3 }` | The outbound log, `sandbox/outbound.log`, on this machine only: what was asked, when, allowed or denied. Like a security camera it keeps to `maxMb` (the oldest lines go first) and forgets lines older than `keepDays` (1, 3, 7 or 30). The Box page's first-run page asks both, and its log button shows the whole log, not the last 15. Only HTTPS to a host and port goes through the proxy: plain HTTP and other protocols have no way out and aren't asked about. |
| `memory`, `cpus` | a fifth of what Docker has | Ceilings that leave the other four fifths free, so a runaway agent can't hog the machine. Set `"memory": "3g", "cpus": 4` to give it more. |

Whatever isn't listed isn't there: your home folder, your SSH keys, your other repos, your `gh` login.

## What the box does by default

- Runs as a non-root user, with every Linux capability dropped, `no-new-privileges`, a read-only root filesystem
  (only `/tmp` and the home volume are writable) and a process limit.
- Binds `0.0.0.0` *inside* the box, since that's where Docker needs it, and publishes to the host's loopback.
  The office password is generated per `up` and printed once.
- Keeps the office's own state and the agents' sign-ins in a named volume (`agent-office-box-home`), so
  `down` then `up` brings your workers' history back. `docker volume rm agent-office-box-home` forgets it.
- Has a Docker `HEALTHCHECK` on `/login`; `status` also asks the port from the outside.

Sign the agents in once inside a worker's terminal (`claude`, `gh auth login`); those logins live in the volume,
not on your machine. A `GH_TOKEN` passed through `env` is the other way, and it can do whatever that token can.

## What it doesn't do (yet)

- **The allowlist is HTTPS-only and by host name.** The proxy sees the name in `CONNECT`, not the traffic, and plain
  HTTP and other protocols (git over ssh) have no way out. Use `https://` remotes.
- **Edits reach the box on its next start.** Settings › You has a Box section (run from the host, where `sandbox/` is):
  approve or revoke a mount, set its access, switch the network, pass a variable, and see the container and port
  health. It saves `sandbox/box.json`, and says when the running box differs; `bun run office:box up` applies it.
- A mounted `rw` repo is writable by the agents, including its `.git` and any hooks in it. Mount what you'd let them edit.
- Docker on a Mac runs in a VM, which is part of the isolation; Linux hosts share a kernel with the box.
