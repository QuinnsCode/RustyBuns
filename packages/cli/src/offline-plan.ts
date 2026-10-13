// `rustybuns plan --offline` (#1197): the plan against empty state, with no account and no API call.
//
// For trying someone else's repo, where nothing may touch their Cloudflare (or Hetzner, Railway, Neon)
// account and yours shouldn't be lent to it either. With no state every resource is a create, so the
// plan is the generated stack's own list: read off .rustybuns/alchemy.run.ts, the file Alchemy would run.

/** Calls in the stack that make nothing of their own in the account, with what they are instead. */
const NOT_MADE: Record<string, string> = {
  "Cloudflare.Artifacts.Namespace": "a binding, nothing to create",
  "Cloudflare.Images.Images": "a binding, nothing to create",
  "Cloudflare.Email.SendEmail": "a binding, nothing to create",
  "Cloudflare.RateLimit": "a binding, nothing to create",
  "Cloudflare.Workers.AI": "a binding, nothing to create",
  "Cloudflare.DurableObject": "made with the Worker",
};

/** `note`: why it isn't a create of its own (NOT_MADE). */
export interface PlannedResource { type: string; id: string; note?: string }

/** Every resource the generated stack declares, in its order: the first string argument of each provider call. */
export function plannedResources(stack: string): PlannedResource[] {
  const out: PlannedResource[] = [];
  const seen = new Set<string>();
  for (const m of stack.matchAll(/\b((?:Cloudflare|Hetzner|Railway|Command|Neon)\.[\w.]+|Alchemy\.makeRandom)\("([^"]+)"/g)) {
    const [, type, id] = m as unknown as [string, string, string];
    const key = `${type} ${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: type === "Alchemy.makeRandom" ? "Alchemy.Random" : type, id, ...(NOT_MADE[type] ? { note: NOT_MADE[type] } : {}) });
  }
  return out;
}

/** The plan as `plan` prints it: a `+` per resource to create, a `~` with its note for the rest. */
export function formatOfflinePlan(name: string, stage: string, resources: PlannedResource[]): string {
  const width = Math.max(0, ...resources.map((r) => r.id.length));
  const creates = resources.filter((r) => !r.note).length;
  return [
    `offline plan for ${name} (stage ${stage}), against empty state: no login, no API calls, nothing read from any account`,
    "",
    ...resources.map((r) => `  ${r.note ? "~" : "+"} ${r.id.padEnd(width)}  ${r.type}${r.note ? `  (${r.note})` : ""}`),
    "",
    `${creates} to create. A real \`rustybuns plan\` reads the account and its state, so it may find some of these already there.`,
    "This doesn't count as a plan for `rustybuns deploy`.",
  ].join("\n");
}
