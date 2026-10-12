# Security

## Reporting a problem

Please report anything that looks like a vulnerability privately, with **Report a vulnerability** on this repo's [Security tab](https://github.com/QuinnsCode/RustyBuns/security), not in a public issue. I'll reply there.

## Dependencies

codeSplitter' [dependency doctor](apps/codesplitter/README.md) keeps a repo's dependencies current on a schedule, so nobody has to remember to:

- A new release isn't taken until it has been out for a few days, since a bad or hijacked release is usually pulled by then.
- Each dependency is checked against [OSV](https://osv.dev) (GitHub's and npm's advisories). A vulnerable one is moved to its fixed release right away, and one with no fix yet is flagged.
- Updates are installed with install scripts off and tested in a throwaway clone before anyone is asked to merge them.

Any repo hosted on codeSplitter can turn it on. Running it on this repo is [#615](https://github.com/QuinnsCode/RustyBuns/issues/615).

## The examples

The example apps change quickly and haven't had a formal security review. See the caution in the [README](README.md#see-it-work).

## Agents

Agents write most of this repo. [notes/SECURITY_AUDIT.md](notes/SECURITY_AUDIT.md) covers how we keep a bad or prompt-injected agent away from secrets, `main` and other people's code: each surface, what's done, and what's still open (issues labelled `security`).
