// Three scripts an org can install to see what one looks like (POST /api/orgs/:org/scripts/examples).
// A body is the inside of `async ({ input, qcrm, log }) => { … }`: see scripts.ts for `qcrm`.

export const EXAMPLES: { name: string; body: string }[] = [
  {
    name: "Stale deals to notes",
    body: `// Every open deal whose close date has passed gets a note on its contact.
const now = Date.now();
let page = await qcrm.list("deals", { limit: 200 }), noted = 0;
for (const deal of page.items) {
  if (deal.stage === "won" || deal.stage === "lost" || !deal.close_at || deal.close_at > now) continue;
  await qcrm.create("activities", { type: "note", deal_id: deal.id, contact_id: deal.contact_id, body: "Close date passed: " + deal.name + " is still " + deal.stage });
  noted++;
}
log(noted + " stale deals noted");
return { noted };`,
  },
  {
    name: "Title case contact names",
    body: `// "ada BERG" becomes "Ada Berg". Only rows that change are written.
const title = (s) => (s ?? "").toLowerCase().replace(/(^|[\\s-])\\S/g, (c) => c.toUpperCase());
let fixed = 0, cursor = null;
do {
  const page = await qcrm.list("contacts", { limit: 200, ...(cursor ? { cursor } : {}) });
  for (const c of page.items) {
    const first = title(c.first_name), last = title(c.last_name);
    if (first !== (c.first_name ?? "") || last !== (c.last_name ?? "")) { await qcrm.update("contacts", c.id, { first_name: first, last_name: last }); fixed++; }
  }
  cursor = page.next;
} while (cursor && fixed < 150);
log(fixed + " names fixed");
return { fixed };`,
  },
  {
    name: "Pipeline summary",
    body: `// The org's numbers, with one line a person can read.
const i = await qcrm.insights();
const open = i.deals_by_stage.filter((s) => s.stage !== "won" && s.stage !== "lost").reduce((n, s) => n + s.amount_cents, 0);
const rate = i.last_90_days.win_rate === null ? "no closed deals" : Math.round(i.last_90_days.win_rate * 100) + "% won";
const summary = i.counts.contacts + " contacts, " + i.counts.deals + " deals, $" + Math.round(open / 100).toLocaleString("en-US") + " open, " + rate + " in the last 90 days";
log(summary);
return { ...i, summary };`,
  },
];
