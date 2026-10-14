// The favourite-features vote behind the docs home page: visitors drag features into S/A/B/C tiers and
// send the ranking with a comment. Only the last KEEP votes are kept; the home page cycles through them.
// This file is the logic with no Cloudflare in it (so bun test can run it); worker.ts is the glue.
export const KEEP = 50;
export const TIERS = ["S", "A", "B", "C"] as const;
const MIN_GAP_MS = 15_000; // one vote per visitor every 15 seconds

export type Vote = { id: string; at: number; tiers: Record<string, string>; comment: string };
export type Store = { read(): Promise<Vote[]>; write(votes: Vote[]): Promise<void> };

// A posted body in, a clean vote out (or the reason it was refused). Feature slugs are not checked
// against a list, because the features change with each release: the page ignores slugs it doesn't know.
export function parseVote(body: unknown): { tiers: Record<string, string>; comment: string } | string {
  if (typeof body !== "object" || body === null) return "send a JSON object";
  const { tiers, comment = "" } = body as { tiers?: unknown; comment?: unknown };
  if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) return "tiers must be an object of feature to tier";
  if (typeof comment !== "string") return "comment must be text";
  const clean: Record<string, string> = {};
  for (const [slug, tier] of Object.entries(tiers)) {
    if (!/^[a-z0-9_-]{1,80}$/.test(slug)) return `bad feature id ${JSON.stringify(slug.slice(0, 20))}`;
    if (!(TIERS as readonly unknown[]).includes(tier)) return `${slug}: tier must be one of ${TIERS.join(", ")}`;
    clean[slug] = tier as string;
  }
  if (!Object.keys(clean).length) return "rank at least one feature";
  if (Object.keys(clean).length > 40) return "too many features";
  return { tiers: clean, comment: comment.trim().slice(0, 280) };
}

export const push = (votes: Vote[], vote: Vote) => [...votes, vote].slice(-KEEP);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// GET /api/votes lists the kept votes, oldest first. POST adds one. `who` is the visitor (an address
// or anything stable) for the rate limit, and `last` remembers when each one last voted.
export async function handleVotes(req: Request, store: Store, who: string, last: Map<string, number>, now = Date.now()): Promise<Response> {
  if (req.method === "GET") return json({ votes: await store.read() });
  if (req.method !== "POST") return json({ error: "GET or POST" }, 405);
  if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "send application/json" }, 415);
  const text = await req.text();
  if (text.length > 4096) return json({ error: "too big" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
  const vote = parseVote(body);
  if (typeof vote === "string") return json({ error: vote }, 400);
  const before = last.get(who);
  if (before !== undefined && now - before < MIN_GAP_MS) return json({ error: "easy there, one vote every 15 seconds" }, 429);
  last.set(who, now);
  if (last.size > 1000) for (const [k, t] of last) if (now - t > MIN_GAP_MS) last.delete(k);
  const votes = push(await store.read(), { id: crypto.randomUUID(), at: now, ...vote });
  await store.write(votes);
  return json({ votes }, 201);
}
