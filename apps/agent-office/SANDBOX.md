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
| `network` | `open` | `open` lets the agents reach the model and GitHub. `offline` cuts the network and publishes no port (for reading code you don't trust). |
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

- **`open` means the whole internet.** Allowing only the model API, GitHub and your registry needs an egress
  proxy beside the box.
- **No UI.** The permission set is a JSON file and `status` is a command. A page in the office for editing grants,
  seeing port health and approving a new mount is the next step.
- A mounted `rw` repo is writable by the agents, including its `.git` and any hooks in it. Mount what you'd let them edit.
- Docker on a Mac runs in a VM, which is part of the isolation; Linux hosts share a kernel with the box.
