// The Scale tab's `ms` (src/scale.ts) from our live apps (#3892): for each Durable Object namespace on the account, the
// active time Cloudflare billed over the last days divided by the socket messages it received. room-stress.ts can
// only time the relay's own JavaScript; this is what workerd really charges per message, its per-event cost included.
// Active time also counts HTTP requests and alarms, so a room that only relays reads true and a busier class reads high.
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bun apps/eqosys/scripts/do-ms.ts [days]
// The token needs "Account Analytics: Read" and "Workers Scripts: Read" (a custom token; wrangler's login has no analytics scope).
import { arr, num, obj, opt, str } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";

/** One namespace's day in durableObjectsPeriodicGroups: activeTime is microseconds. */
export const Periodic = obj({
  data: obj({ viewer: obj({ accounts: arr(obj({ durableObjectsPeriodicGroups: arr(obj({
    dimensions: obj({ namespaceId: str(64) }),
    sum: obj({ activeTime: num(0, Number.MAX_SAFE_INTEGER), inboundWebsocketMsgCount: num(0, Number.MAX_SAFE_INTEGER) }),
  }), 10_000) }), 1) }) }),
});
export const Namespaces = obj({ result: arr(obj({ id: str(64), name: opt(str(200)), script: opt(str(200)), class: opt(str(200)) }), 1000) });

export type Row = { ns: string; msgs: number; ms: number };

/** Active ms per incoming message, per namespace, busiest first. Namespaces under `min` messages are noise and left out. */
export function msPerMessage(reply: ReturnType<typeof Periodic>, names: Map<string, string>, min = 1000): Row[] {
  const by = new Map<string, { us: number; msgs: number }>();
  for (const g of reply.data.viewer.accounts[0]?.durableObjectsPeriodicGroups ?? []) {
    const t = by.get(g.dimensions.namespaceId) ?? { us: 0, msgs: 0 };
    t.us += g.sum.activeTime; t.msgs += g.sum.inboundWebsocketMsgCount;
    by.set(g.dimensions.namespaceId, t);
  }
  return [...by].filter(([, t]) => t.msgs >= min)
    .map(([id, t]) => ({ ns: names.get(id) ?? id, msgs: t.msgs, ms: t.us / 1000 / t.msgs }))
    .sort((a, b) => b.msgs - a.msgs);
}

if (import.meta.main) {
  const token = process.env.CLOUDFLARE_API_TOKEN, acc = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !acc) {
    console.error("Set CLOUDFLARE_API_TOKEN (Account Analytics: Read, Workers Scripts: Read) and CLOUDFLARE_ACCOUNT_ID.");
    process.exit(1);
  }
  const days = Math.max(1, Math.min(30, Number(process.argv[2] ?? 7)));
  const auth = { authorization: `Bearer ${token}` };
  const day = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const query = `query($acc: String!, $since: Date!, $until: Date!) { viewer { accounts(filter: {accountTag: $acc}) {
    durableObjectsPeriodicGroups(limit: 10000, filter: {date_geq: $since, date_leq: $until}) {
      dimensions { namespaceId } sum { activeTime inboundWebsocketMsgCount } } } } }`;
  const reply = await getJson("https://api.cloudflare.com/client/v4/graphql", Periodic, {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { acc, since: day(days), until: day(0) } }),
  });
  if (!reply) {
    console.error("Cloudflare's analytics didn't answer with DO numbers (check the token's Account Analytics: Read).");
    process.exit(1);
  }
  const ns = await getJson(`https://api.cloudflare.com/client/v4/accounts/${acc}/workers/durable_objects/namespaces?per_page=1000`, Namespaces, { headers: auth });
  const names = new Map((ns?.result ?? []).map((n) => [n.id, [n.script, n.class ?? n.name].filter(Boolean).join(" ")]));
  const rows = msPerMessage(reply, names);
  if (rows.length === 0) { console.log(`No namespace took 1000 socket messages in the last ${days} days.`); process.exit(0); }
  console.log(`Active ms per incoming socket message, last ${days} days:`);
  for (const r of rows) console.log(`  ${r.ms.toFixed(3).padStart(8)} ms  ${r.msgs.toLocaleString("en-US").padStart(12)} msgs  ${r.ns}`);
  console.log(`Set \`ms\` in src/scale.ts's DEFAULT from the relay rooms (the lowest busy rows); it is 0.1 today.`);
}

