# Set up a Mac

From a Mac you haven't touched in a while to one that runs the whole setup: the Agent Office, coding agents, codeSplitter,
and tests on a second machine. Written for someone doing it the first time. Every command goes in a terminal (Warp, or
Terminal.app until Warp is in).

There are two kinds of Mac here:

- **The Mac you work on.** It runs the office and the agents, and it holds your logins.
- **A builder.** It only runs tests and builds for the first one, over SSH. It holds **no** logins: no GitHub token, no
  Claude, no codeSplitter, no 1Password. If someone gets into it, there is nothing to take.

A new person with one Mac does Parts 1, 2 and 3. A spare Mac becoming a builder (the 64 GB MacBook Pro) does Parts 1, 2
and 4. Part 5 is how to keep either one up to date.

## Part 1: Update the Mac (30-60 min, mostly waiting)

- [ ] **Back up first** if there's anything on it you'd miss (Time Machine, or copy it off).
- [ ] **Plug it in.** Updates stop on low battery.
- [ ] **macOS:** System Settings > General > Software Update. Install everything, restart, then check again until it says
      it's up to date. From a terminal: `softwareupdate -l` lists them, `sudo softwareupdate -ia --restart` installs them.
- [ ] **FileVault on** (System Settings > Privacy & Security > FileVault), so a lost Mac is a locked Mac.
- [ ] **Firewall on** (System Settings > Network > Firewall).
- [ ] **Free disk:** keep 100 GB or more free. Docker images and `node_modules` add up. Apple menu > About This Mac >
      More Info > Storage.

## Part 2: The tools (20-40 min)

Install each one, or update it if it's already there. Run them in this order: later ones need earlier ones.

| | What it's for | Install | Update |
|---|---|---|---|
| [ ] Command Line Tools | git, a C compiler (Rust and some packages need it) | `xcode-select --install` | comes with macOS updates |
| [ ] [Homebrew](https://brew.sh) | installs the rest | the one-line installer on brew.sh, then the two `echo ... >> ~/.zprofile` lines it prints | `brew update && brew upgrade` |
| [ ] Warp | the terminal | `brew install --cask warp` | it updates itself; or `brew upgrade --cask warp` |
| [ ] git and gh | git, and GitHub from the terminal | `brew install git gh` | `brew upgrade` |
| [ ] [Bun](https://bun.sh) 1.4.3+ | runs everything in this repo | `curl -fsSL https://bun.sh/install \| bash` | `bun upgrade` |
| [ ] Docker Desktop | container builds and sandboxes | `brew install --cask docker`, then open it once | Docker menu > Check for updates |
| [ ] [Rust](https://rustup.rs) | the apps with native code (fm-daw, hippo-tycoon, auto-rig, motion-midi) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`, then `rustup target add wasm32-unknown-unknown` | `rustup update` |
| [ ] Tailscale (optional) | reach this Mac from your phone or from outside your Wi-Fi | `brew install --cask tailscale`, then sign in | it updates itself |

Then:

- [ ] `brew doctor` says "Your system is ready to brew" (or fix what it lists).
- [ ] Open a new terminal tab and check each one answers: `git --version`, `gh --version`, `bun --version`,
      `docker --version`, `cargo --version`.
- [ ] **Docker resources:** Docker Desktop > Settings > Resources. Memory about three quarters of the Mac's RAM (about 48
      GB on a 64 GB Mac, 10-12 GB on a 16 GB one), all CPUs, disk 120 GB or more.

## Part 3: The Mac you work on (30 min)

### Sign in

- [ ] **GitHub:** `gh auth login`. Pick GitHub.com, HTTPS, and "Login with a web browser".
- [ ] **Claude Code:** `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` once and sign in. Update with
      `claude update`.
- [ ] **codeSplitter:** `curl -fsSL https://codesplitter.notryanquinn.workers.dev/install.sh | sh`, then
      `codesplitter login` and paste a token from your profile page on the site. `codesplitter tools` lists what it can do.
- [ ] **codeSplitter for Claude** (optional): `claude mcp add --transport http codesplitter https://codesplitter.notryanquinn.workers.dev/api/mcp`,
      then in Claude type `/mcp`, pick codesplitter and Authenticate.
- [ ] **Deploys (the owner only):** the 1Password app and CLI, set up as in
      [codeSplitter's REFERENCE](apps/codesplitter/REFERENCE.md). Nobody else needs this; agents never get it.

### Get the code and run the office

- [ ] Clone it somewhere of your own: `mkdir -p ~/Documents/projects && cd ~/Documents/projects && gh repo clone QuinnsCode/RustyBuns`
- [ ] `cd RustyBuns && bun install --frozen-lockfile`
- [ ] Start the office: `cd apps/agent-office && bun run office`. It opens in the browser. Keep that terminal open.
      `bun run office:update` later pulls and swaps in a new one without stopping the workers.
- [ ] Hire your first worker from the office and give it a small task. It works in its own copy of the repo
      (a worktree), so it can't break yours.
- [ ] From your phone (optional, needs Tailscale): `bun run office:phone` in `apps/agent-office` prints the link.

Read [AGENTS.md](AGENTS.md) once: it's the rules every agent here follows, and the ones you'll see them keep.

## Part 4: A builder (20 min, plus the first installs)

Do Parts 1 and 2 first, but skip every sign-in. Then on the builder:

- [ ] **Remote Login on:** System Settings > General > Sharing > Remote Login. Note the name it shows
      (`you@Your-Mac.local`).
- [ ] **Stay plugged in.** The setup turns off sleep on power, lid closed included. On battery it still sleeps.
- [ ] **Run the setup** (asks for your password once, for the sleep setting):

  ```sh
  curl -fsSL https://raw.githubusercontent.com/QuinnsCode/RustyBuns/main/scripts/builder-setup.sh | sh -s -- 3
  ```

  The `3` is how many test runs it takes at once. It makes three warm copies of the repo in `~/builder`, checks SSH,
  Bun and Docker, times one test suite, and prints the lines for the next step. Running it again is safe: it only
  updates.

Then on the Mac you work on:

- [ ] `ssh-copy-id you@Your-Mac.local` (once; asks for the builder's password one last time).
- [ ] `echo 'export BUILDER_HOST=you@Your-Mac.local' >> ~/.zshenv`, then restart the office so the workers see it.
- [ ] Check it from your clone: `bun run builder run scripts bun test ./ci-tier.test.ts`. It should print the tests
      passing "on you@Your-Mac.local".
- [ ] Optional, once it works: turn off password logins over SSH, so only your key gets in. On the builder:
      `echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/keys-only.conf`, then turn Remote Login off and on.

From then on the agents run their tests there with `bun run builder` (see [AGENTS.md](AGENTS.md#tests-ci-runs-the-suite)).
The builder only runs branches sent from your own office; GitHub's CI is still what a merge has to pass.

## Part 5: Keep it up to date (about 10 min, weekly)

```sh
softwareupdate -l                  # anything listed: System Settings > General > Software Update
brew update && brew upgrade        # Warp, Docker, git, gh, Tailscale if brew installed them
bun upgrade
rustup update
claude update                      # the Mac you work on
```

- On the Mac you work on: `bun run office:update` in `apps/agent-office`.
- On a builder: run the setup line from Part 4 again. It pulls the latest code into each copy and reinstalls.
- After a macOS update, open Docker Desktop once to make sure it starts.
