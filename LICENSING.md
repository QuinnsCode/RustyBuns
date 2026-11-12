# Licensing

Rusty Buns is licensed under the Apache License, Version 2.0. See LICENSE.

## The stack rule

Rusty Buns wires other projects together. It does not relicense them.
Your shipped app is governed by the most restrictive license of anything
it includes. At the time of writing, the core stack is:

| Component | License |
|---|---|
| Rusty Buns | Apache-2.0 |
| Alchemy    | Apache-2.0 |
| Bun        | MIT |
| Vite       | MIT |
| React      | MIT |
| Effect     | MIT |

All permissive. Apache-2.0 is the "heaviest" of these, so a plain Rusty
Buns app inherits Apache-2.0 obligations: keep the LICENSE and NOTICE
files, state changes to Apache-licensed files, and don't use our marks
to imply endorsement.

## What changes that

- **Your own code and assets** are yours. Rusty Buns claims nothing.
- **Rust crates you add** carry their own licenses. Most are MIT/Apache
  dual; check any that aren't (GPL/LGPL crates in a cdylib change your
  obligations).
- **npm packages you add** are the same story. `bun pm licenses` (or
  `license-checker`) lists them.
- **The browser** is the user's. Launching Chrome in --app mode is using
  installed software, not distributing it. Do not bundle Google Chrome.
- **Cloud providers** are governed by their terms of service, not by this
  file.

## Games

The game example apps are public and Apache-2.0 like the rest, but the repo
leaves them out of "Download ZIP", `git archive` and source tarballs
(`.gitattributes`, `export-ignore`). You can still clone and read them; there
is just no one-click download. That is a speed bump, not protection: anyone
who clones has the source. To restrict what people may *do* with a game, give
it its own LICENSE as `apps/qcrm` does, which is a decision for the owner.
Built desktop releases are separate and stay downloadable.

## Apps under their own license

Rusty Buns (the framework, the CLI, `packages/*` and the example apps) is the
open part. A few apps are QNTBR's own and carry the QNTBR license in their
directory instead: read them, run them to evaluate, send fixes; don't copy,
resell or host them for others.

| App | License |
|---|---|
| `apps/qcrm` | QNTBR ([LICENSE](apps/qcrm/LICENSE)) |
| `apps/eqosys` | QNTBR ([LICENSE](apps/eqosys/LICENSE)) |
| `apps/qollab` | QNTBR ([LICENSE](apps/qollab/LICENSE)) |

eqosys (accounts) and Qollab (parties, rooms, presence) are the hosted upgrade
for a game, not part of the open stack. The client a game talks to them with
(`@rustybuns/util/eqosys`, `@rustybuns/util/token`) stays Apache-2.0, so a
game built on Rusty Buns ships open and can either use the hosted service or
bring its own accounts and rooms when it self-hosts.

## Contributions

Contributions are accepted under Apache-2.0, the same terms as the
project (inbound = outbound). No CLA.

This file is guidance, not legal advice. Check with counsel for anything
you plan to sell.