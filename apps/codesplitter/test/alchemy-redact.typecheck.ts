// Tripwire for #605, checked by `bun run typecheck`, not run by `bun test`.
//
// Alchemy's Worker upload has no `observability.redactQueryString` yet, so
// `rustybuns deploy` turns it on after each upload (packages/cli/src/redact.ts).
// When an Alchemy bump adds the field, the @ts-expect-error below goes unused and
// typecheck fails here: emit `redactQueryString: true` in packages/cli/src/gen/alchemy.ts,
// drop the post-deploy step and this file, and close #605.
import type { WorkerObservability } from "alchemy/Cloudflare";

// @ts-expect-error #605: Alchemy now takes redactQueryString, see above.
export const redactInUpload: keyof WorkerObservability = "redactQueryString";
