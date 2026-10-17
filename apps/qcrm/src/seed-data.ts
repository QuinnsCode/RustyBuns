// Fake but plausible CRM data, the same every time for the same seed: about one company per
// twelve contacts, one deal per three, zero to four activities per contact. Emails are unique
// by construction (first.last.<i>@<company domain>). Rows come in batches so 100,000 contacts
// never sit in memory at once, and seedOrg writes them 400 statements per D1 batch with ONE
// `changes` row per batch (op "seed"), so a syncing client learns the org was seeded rather
// than replaying every row.
//
//   POST /api/orgs/:org/seed {n}   (owner+, n ≤ 100000)

import { error, json, readBody, type D1Statement, type Env, type Row } from "./env.ts";
import type { Ctx } from "./orgs.ts";

export const MAX_SEED = 100_000;
const STMTS_PER_BATCH = 400;

/** mulberry32: a small seeded generator, enough for names and amounts. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FIRST = ["Ada", "Ben", "Carla", "Dev", "Elena", "Femi", "Grace", "Hugo", "Iris", "Jonas", "Kai", "Lena", "Marco", "Nia", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Tariq", "Uma", "Viktor", "Wren", "Ximena", "Yusuf", "Zoe", "Amir", "Beatriz", "Caleb", "Dana", "Ezra", "Freya", "Gus", "Hana", "Ivan", "Jade", "Kofi", "Lior", "Mina", "Noor"];
const LAST = ["Abara", "Berg", "Castillo", "Dubois", "Eriksen", "Fischer", "Garcia", "Haddad", "Ito", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrov", "Quist", "Rahman", "Santos", "Tanaka", "Ueda", "Varga", "Walsh", "Xu", "Yilmaz", "Zhang", "Adeyemi", "Brennan", "Costa", "Dimitrov"];
const WORDS = ["Blue", "North", "Summit", "Harbor", "Cedar", "Quartz", "Lumen", "Delta", "Pine", "Atlas", "Orbit", "Maple", "Granite", "Beacon", "Willow", "Ember", "Vector", "Meadow", "Copper", "Signal"];
const KINDS = ["Labs", "Logistics", "Foods", "Systems", "Health", "Studio", "Works", "Energy", "Capital", "Robotics"];
const INDUSTRIES = ["software", "logistics", "retail", "health", "finance", "manufacturing", "media", "energy", "education", "hospitality"];
const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const TITLES = ["Founder", "CEO", "CTO", "Head of Sales", "Ops Lead", "Buyer", "Engineer", "Marketing Lead", "Account Manager", "Analyst"];
const TAGS = ["lead", "newsletter", "conference", "partner", "vip", "churn-risk", "referral"];
const STAGES = ["lead", "lead", "qualified", "qualified", "proposal", "won", "lost"];
const TYPES = ["call", "email", "email", "meeting", "note", "note"];
const NOTES = ["Followed up after the demo.", "Asked for pricing by Friday.", "Intro call went well, wants a trial.", "Renewal due next quarter.", "Prefers email over calls.", "Met at the conference booth.", "Sent the proposal deck.", "Waiting on procurement."];

export interface Batch { companies: Row[]; contacts: Row[]; deals: Row[]; activities: Row[] }

/** Batches of `per` contacts and what hangs off them, `n` contacts in all. */
export function* seedRows(n: number, seed = 1, per = 100): Generator<Batch> {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const now = Date.now(), day = 86_400_000;
  let company: Row | null = null;
  for (let start = 0; start < n; start += per) {
    const b: Batch = { companies: [], contacts: [], deals: [], activities: [] };
    for (let i = start; i < Math.min(n, start + per); i++) {
      if (i % 12 === 0 || !company) {
        const name = `${pick(WORDS)} ${pick(KINDS)}`;
        const domain = `${name.toLowerCase().replace(/\s+/g, "")}${i ? "-" + Math.floor(i / 12) : ""}.example`;
        const created_at = now - Math.floor(r() * 720) * day;
        company = { id: crypto.randomUUID(), name, domain, industry: pick(INDUSTRIES), size: pick(SIZES), created_at, updated_at: created_at };
        b.companies.push(company);
      }
      const first = pick(FIRST), last = pick(LAST);
      const created_at = now - Math.floor(r() * 540) * day;
      const tags = r() < 0.5 ? [pick(TAGS)] : r() < 0.3 ? [pick(TAGS), pick(TAGS)] : [];
      const contact: Row = {
        id: crypto.randomUUID(), first_name: first, last_name: last, email: `${first}.${last}.${i}@${company.domain}`.toLowerCase(),
        phone: `+1 555 ${String(1000 + Math.floor(r() * 9000))} ${String(1000 + Math.floor(r() * 9000))}`, title: pick(TITLES), company_id: company.id,
        tags: JSON.stringify([...new Set(tags)]), notes: r() < 0.3 ? pick(NOTES) : null, created_at, updated_at: Math.min(now, created_at + Math.floor(r() * 30) * day),
      };
      b.contacts.push(contact);
      if (i % 3 === 0) {
        const stage = pick(STAGES), opened = created_at + Math.floor(r() * 60) * day;
        b.deals.push({ id: crypto.randomUUID(), name: `${company.name}: ${pick(["pilot", "renewal", "expansion", "starter", "enterprise"])}`, contact_id: contact.id, company_id: company.id,
          stage, amount_cents: (5 + Math.floor(r() * 400)) * 10_000, currency: "USD", close_at: stage === "won" || stage === "lost" ? opened + Math.floor(r() * 90) * day : now + Math.floor(r() * 120) * day,
          created_at: opened, updated_at: Math.min(now, opened + Math.floor(r() * 90) * day) });
      }
      const acts = Math.floor(r() * 5);
      for (let k = 0; k < acts; k++) {
        const at = now - Math.floor(r() * 180) * day;
        b.activities.push({ id: crypto.randomUUID(), type: pick(TYPES), contact_id: contact.id, deal_id: null, body: pick(NOTES), at, created_at: at, updated_at: at });
      }
    }
    yield b;
  }
}

const INSERT: Record<keyof Batch, string> = {
  companies: "INSERT INTO companies (id, org_id, name, domain, industry, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  contacts: "INSERT INTO contacts (id, org_id, first_name, last_name, email, phone, title, company_id, tags, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  deals: "INSERT INTO deals (id, org_id, name, contact_id, company_id, stage, amount_cents, currency, close_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  activities: "INSERT INTO activities (id, org_id, type, contact_id, deal_id, body, at, actor_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
};
const COLS: Record<keyof Batch, string[]> = {
  companies: ["name", "domain", "industry", "size", "created_at", "updated_at"],
  contacts: ["first_name", "last_name", "email", "phone", "title", "company_id", "tags", "notes", "created_at", "updated_at"],
  deals: ["name", "contact_id", "company_id", "stage", "amount_cents", "currency", "close_at", "created_at", "updated_at"],
  activities: ["type", "contact_id", "deal_id", "body", "at", "actor_user_id", "created_at", "updated_at"],
};

/** Seed `n` contacts (and their companies, deals, activities) into `org`. Returns the counts. */
export async function seedOrg(env: Env, org: string, actorId: string | null, n: number, seed = 1) {
  const counts = { contacts: 0, companies: 0, deals: 0, activities: 0 };
  let pending: D1Statement[] = [], tally = { ...counts };
  const flush = async () => {
    if (!pending.length) return;
    pending.push(env.DB.prepare("INSERT INTO changes (org_id, entity, entity_id, op, actor_user_id, at, data) VALUES (?, 'org', ?, 'seed', ?, ?, ?)").bind(org, org, actorId, Date.now(), JSON.stringify(tally)));
    await env.DB.batch(pending);
    pending = []; tally = { ...counts, contacts: 0, companies: 0, deals: 0, activities: 0 };
  };
  for (const batch of seedRows(n, seed)) {
    for (const table of Object.keys(INSERT) as (keyof Batch)[]) {
      for (const row of batch[table]) {
        row.actor_user_id ??= actorId;
        pending.push(env.DB.prepare(INSERT[table]).bind(row.id, org, ...COLS[table].map((c) => row[c] ?? null)));
        counts[table]++; tally[table]++;
        if (pending.length >= STMTS_PER_BATCH - 1) await flush();
      }
    }
  }
  await flush();
  return counts;
}

export async function seedRoutes({ req, env, user, org, p, audit }: Ctx): Promise<Response | null> {
  if (p[0] !== "seed" || p[1] || req.method !== "POST") return null;
  const b = await readBody<{ n?: unknown; seed?: unknown }>(req);
  const n = Number(b?.n);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEED) return error(400, `n: 1 to ${MAX_SEED} contacts`);
  const counts = await seedOrg(env, org, user.id, n, Number.isInteger(b?.seed) ? (b!.seed as number) : Date.now() % 100_000);
  await audit("seed", null, counts);
  return json(counts, 201);
}
