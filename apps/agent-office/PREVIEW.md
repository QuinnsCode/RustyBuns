# Office preview runbook

How to run the ephemeral preview from [MOVE.md](MOVE.md) section 1 (#1385). The stage is `office-preview` in
`apps/codesplitter/rustybuns.config.ts`. It has its own Worker, D1, R2 bucket, four queues, Artifacts namespace and
rate-limit namespace, takes nothing over from the live Worker (`renamedFrom` is dropped for a stage with its own
Worker name), protects nothing, runs no crons and has Turnstile off. `test/office-preview-stage.test.ts` fails if it
ever shares a name with the live stage.

**What is not built yet.** This is the stage and the runbook only. The office itself (the Durable Object for the
queue, desks and roster, and the 3D client served from the Worker) and the four gaps in MOVE.md (PTY over WebSocket,
container lifetime, per-floor cost cap, auth mapping) are not in it, so checks 1 to 5 below can't pass until those land.
They are filed as follow-ups; this stage is where they get tried.

## Stay-alive rule (#1412)

The owner wants the Druids office running in codeSplitter and kept up until they have seen it. Until they say so:

- Do not `rustybuns destroy --stage office-preview`, and do not send home the worker driving the preview.
- The live office (`apps/agent-office` binary) and the live codeSplitter stage keep running untouched.
- Deploy and viewing are a MANUAL RUN: they need the owner (secrets via varlock).
- Price it first (below and `COSTS.md`), smallest resources, destroy only after the owner has seen it.

**"Its own room" is still open.** The owner may move codeSplitter to "its own room" on 2026-10-14. Whether that means its
own repo, org or deploy is not settled; write the answer here once it is. Whatever it is, `apps/codesplitter` must stay
valid for the Cloudflare git competition (Workers + Artifacts, `LICENSE`, accurate run instructions, tag
`contest-submission`; submissions close 2026-10-14 11:59 PM PDT).

## Price (put the real figure on the PR before deploying)

Containers are billed by use, at the `basic` size (1/4 vCPU, 1 GiB, 4 GB disk), about $0.03 an hour per running
container at Cloudflare's published rates. Check the current rates before relying on this. Idle bills nothing: a run's
container is stopped when it ends. A verification pass is at most 5 checks, each a handful of short runs,
`AGENT_SANDBOX` capped at 2 at once: under 1 container-hour in total, well under $1, plus the model tokens of the
throwaway tasks. Workers, D1, R2, queues and Durable Objects stay inside Workers Paid's included usage at that scale.
The destroy removes all of it.

## Run it (the owner; secrets go through varlock)

1. A throwaway GitHub repo and a fine-grained token scoped to that one repo. Never `QuinnsCode/RustyBuns`.
2. `cd apps/codesplitter`, then `DEPLOYS=1 AGENTS=1 CHECKS=1 rustybuns deploy --stage office-preview` (the
   `CODESPLITTER_` prefix is accepted too). Read the plan; it must list only `codesplitter-office-preview*` names.
3. Run checks 1 to 5 from MOVE.md and write each result on the PR.
4. Only after the owner has said they have seen the Druids office running in codeSplitter (see the stay-alive rule
   below): `rustybuns destroy --stage office-preview`. Read the KEPT/REMOVED list (#1381); KEPT must be empty. Revoke the token
   and delete the throwaway repo.

**Stay up until the owner has seen it.** Once the Druids office is deployed on this stage, don't run step 4 (and don't
send home the worker driving it) until the owner says they have seen it running ([#1412](https://github.com/QuinnsCode/RustyBuns/issues/1412)).
