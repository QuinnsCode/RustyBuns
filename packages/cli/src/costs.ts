// What a stack can cost, said before plan and deploy, and the one hard stop:
// a Hetzner server bigger than the small tiers needs an explicit opt-in.
// Cloudflare has no spend cap, so the rest is awareness; COSTS.md has the
// account-side switches (Free plan, billing alerts) that actually cap a bill.

import type { RustyBunsConfig } from "./config.ts";
import { boxDefaults } from "./box.ts";

export interface Billable { what: string; kind: "fixed" | "usage"; note: string }

/**
 * Hetzner names carry the size: cx22, cpx31, cax41, ccx13. The first digit is
 * the tier. Tiers 1 and 2 of the shared types are a few euros a month; ccx is
 * dedicated vCPU and starts well above that.
 */
export function largeServer(serverType: string): boolean {
  const m = /^(cx|cpx|cax|ccx)(\d)\d$/i.exec(serverType);
  if (!m) return true;   // unknown names get the same opt-in as large ones
  return m[1]!.toLowerCase() === "ccx" || Number(m[2]) >= 3;
}

export function billables(c: RustyBunsConfig): Billable[] {
  const out: Billable[] = [];
  const edge = !!c.targets.edge || !c.targets.box;
  if (edge && c.worker) {
    out.push({ what: `Cloudflare Worker "${c.name}"`, kind: "usage", note: "requests + CPU time" });
    for (const [name, b] of Object.entries(c.bindings ?? {})) {
      if (b.type === "durable_object") out.push({ what: `Durable Object ${name}`, kind: "usage", note: "duration while awake: open sockets, timers, tick loops" });
      if (b.type === "d1") out.push({ what: `D1 ${name}`, kind: "usage", note: "rows read/written + storage" });
      if (b.type === "kv") out.push({ what: `KV ${name}`, kind: "usage", note: "reads/writes + storage" });
      if (b.type === "r2") out.push({ what: `R2 ${name}`, kind: "usage", note: "storage + operations (egress is free)" });
    }
  }
  if (c.targets.box) {
    const b = boxDefaults(c.targets.box);
    out.push({ what: `Hetzner ${b.serverType} in ${b.location}`, kind: "fixed", note: "billed hourly until destroyed, even powered off" });
    if (b.volumeSize > 0) out.push({ what: `Hetzner Volume ${b.volumeSize} GB`, kind: "fixed", note: "billed until destroyed" });
  }
  return out;
}

export function costReport(c: RustyBunsConfig): string {
  const rows = billables(c);
  const w = Math.max(...rows.map((r) => r.what.length));
  const lines = ["billable resources in this stack:"];
  for (const r of rows) lines.push(`  ${r.what.padEnd(w)}  ${r.kind.padEnd(5)}  ${r.note}`);
  if (rows.some((r) => r.kind === "fixed")) lines.push("  fixed costs stop only with `rustybuns destroy`.");
  lines.push("  account-side caps and alerts: COSTS.md");
  return lines.join("\n");
}

/** Throws if the stack needs a spend opt-in the config does not give. */
export function checkSpend(c: RustyBunsConfig): void {
  const box = c.targets.box;
  if (!box) return;
  const { serverType } = boxDefaults(box);
  if (largeServer(serverType) && !box.allowLargeServer)
    throw new Error(`targets.box.serverType "${serverType}" is past the small shared tiers (cx/cpx/cax 1x-2x). ` +
      `Set targets.box.allowLargeServer: true if you mean it.`);
}
