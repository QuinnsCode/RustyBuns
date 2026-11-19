// GENERATED: server-only modules aliased away in the desktop client bundle.
// A server component that reaches one of these on the desktop gets undefined.
// If you need the real thing, make it a "use server" action: those run on the host.
const noop = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : noop),
  apply: () => undefined,
  construct: () => noop,
}) as any;
export default noop;
export const db = noop, prisma = noop, auth = noop, requestInfo = { ctx: { user: { id: "local", name: "local" } }, request: null, headers: new Headers() };
export const env = new Proxy({}, { get: () => noop });
export class DurableObject { constructor(public ctx: any, public env: any) {} }
