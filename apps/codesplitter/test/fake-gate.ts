import type { GateExports } from "../src/egress.ts";

/**
 * A container Durable Object's ctx for a fake container: the container with the
 * runtime's interception calls added, and `ctx.exports.EgressGate`. Each run's
 * egress list (src/egress.ts) is pushed onto `lists`.
 */
export function gated<C extends object>(c: C, lists: string[][] = []) {
  const container = Object.assign(c, {
    async interceptOutboundHttps(addr: string, g: any) { if (addr === "*") lists.push(g.hosts); },
    async interceptAllOutboundHttp(_g: unknown) {},
  });
  return { container, exports: gateExports };
}

/** `ctx.exports` with the gate in it: the "gate" a container gets is just its props. */
export const gateExports: GateExports = { EgressGate: ({ props }) => props };
