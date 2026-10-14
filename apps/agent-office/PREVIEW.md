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
4. `rustybuns destroy --stage office-preview`. Read the KEPT/REMOVED list (#1381); KEPT must be empty. Revoke the token
   and delete the throwaway repo.
