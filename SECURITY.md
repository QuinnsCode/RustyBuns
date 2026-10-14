# Security

## Reporting a problem

Please report anything that looks like a vulnerability privately, with **Report a vulnerability** on this repo's [Security tab](https://github.com/QuinnsCode/RustyBuns/security), not in a public issue. I'll reply there.

## Dependencies

codeSplitter' [dependency doctor](apps/codesplitter/README.md) keeps a repo's dependencies current on a schedule, so nobody has to remember to:

- A new release isn't taken until it has been out for a few days, since a bad or hijacked release is usually pulled by then.
- Each dependency is checked against [OSV](https://osv.dev) (GitHub's and npm's advisories). A vulnerable one is moved to its fixed release right away, and one with no fix yet is flagged.
- Updates are installed with install scripts off and tested in a throwaway clone before anyone is asked to merge them.

Any repo hosted on codeSplitter can turn it on. Running it on this repo is [#615](https://github.com/QuinnsCode/RustyBuns/issues/615).

## Code settings and Profile settings

codeSplitter keeps its security settings in two places, split by what they are about.

**Code settings** belong to a codebase (a repo). They are about the code and the git side of it, and each repo has its own:

- who can read it (visibility, private lines) and who can write (crew, invites, agents)
- what runs on it: checks (and pinning them to the settings' commands), the dependency doctor, deploys, deploy keys and the review of code that isn't yours

**Profile settings** belong to a person. They are about everything that isn't the git code itself:

- how you sign in: password, GitHub or Google, sessions
- your `cst_` tokens, OAuth apps and the agents acting as you
- your profile page, avatar, city and what the feed shows of you
- your data: export it, delete the account

How they combine:

- A repo's Code settings stand on their own. Nothing in a profile is needed for a repo to be safe.
- A Profile can set a default for all your repos, and a repo's own Code setting wins over it, with one exception: a Profile can also **override** a Code setting to make it stricter. Profile settings can tighten a repo (for example, every agent run on your repos needs your review) but never loosen what the repo's owner set.
- Profile settings that are not about code (sign-in, tokens, data) have no Code counterpart. A repo can't change them, and an agent or token can't change them for you; they are for the person, signed in on the site.
- Whatever the owner of a repo sets applies to everyone on it. Whatever a person sets in their Profile applies only to them.

## What codeSplitter promises, and the tests behind it

[The security model](apps/codesplitter/REFERENCE.md#the-security-model-your-code-your-app-your-provisioning-your-destruction) in codeSplitter's reference says what you hand it (your code, your app, your provisioning, your destruction) and what it promises back, one test per promise, with every delete in a table of what goes and what stays. `bun run smoke` in `apps/codesplitter` runs those tests and the stress script, and `test/trust.test.ts` fails CI when a promise's test is gone.

## The examples

The example apps change quickly and haven't had a formal security review. See the caution in the [README](README.md#see-it-work).

## Agents

Agents write most of this repo. [notes/SECURITY_AUDIT.md](notes/SECURITY_AUDIT.md) covers how we keep a bad or prompt-injected agent away from secrets, `main` and other people's code: each surface, what's done, and what's still open (issues labelled `security`).
