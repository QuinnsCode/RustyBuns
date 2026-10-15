// GET/POST /api/repos/:o/:r/board: the live board (#1524, board.ts). The live process (scripts/mervin-live.ts) posts
// the rows of the PRs whose stage moved; readers get every row with the waves, who can merge now, and the tiers'
// hit rates. `?pr=N` answers for one PR: what blocks it, who should take it, what it blocks.

import type { Env } from "./env.ts";
import { json, readBody } from "./env.ts";
import { ask, brief, canMerge, pick, hitRate, parseRow, waves, type BoardRow, type Hits } from "./board.ts";

const MAX_ROWS = 500;

export async function boardRoutes(req: Request, env: Env, owner: string, repo: string, write: boolean): Promise<Response> {
  const rows = async () => ((await env.DB.prepare("SELECT row, updated_at FROM board_prs WHERE owner = ? AND repo = ? ORDER BY pr").bind(owner, repo).all()).results as { row: string; updated_at: number }[])
    .map((r) => ({ ...(JSON.parse(r.row) as BoardRow), at: r.updated_at }));

  if (req.method === "POST") {
    if (!write) return json({ error: "no write access" }, 403);
    const b = await readBody<"main" | "prs" | "drop" | "replace" | "hits">(req);
    if (typeof b.main !== "string" || !b.main) return json({ error: "main: the commit the board was staged on" }, 400);
    if (!Array.isArray(b.prs) || b.prs.length > MAX_ROWS) return json({ error: `prs: [row] (up to ${MAX_ROWS})` }, 400);
    const parsed: BoardRow[] = [];
    for (const x of b.prs) { const r = parseRow(x); if (typeof r === "string") return json({ error: r }, 400); parsed.push(r); }
    if (b.drop !== undefined && !(Array.isArray(b.drop) && b.drop.every((n) => Number.isInteger(n)))) return json({ error: "drop: [pr number]" }, 400);
    const now = Date.now();
    const gone = b.replace ? (await rows()).map((r) => r.pr).filter((n) => !parsed.some((p) => p.pr === n)) : [];
    const stmts = [
      ...parsed.map((r) => env.DB.prepare("INSERT INTO board_prs (owner, repo, pr, row, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, repo, pr) DO UPDATE SET row = excluded.row, updated_at = excluded.updated_at")
        .bind(owner, repo, r.pr, JSON.stringify(r), now)),
      ...[...((b.drop as number[] | undefined) ?? []), ...gone].map((n) => env.DB.prepare("DELETE FROM board_prs WHERE owner = ? AND repo = ? AND pr = ?").bind(owner, repo, n)),
    ];
    const hits = b.hits && typeof b.hits === "object" && !Array.isArray(b.hits) ? JSON.stringify(b.hits).slice(0, 4000) : null;
    stmts.push(env.DB.prepare("INSERT INTO board_meta (owner, repo, main, hits, updated_at) VALUES (?, ?, ?, COALESCE(?, '{}'), ?) ON CONFLICT (owner, repo) DO UPDATE SET main = excluded.main, hits = COALESCE(?, board_meta.hits), updated_at = excluded.updated_at")
      .bind(owner, repo, b.main, hits, now, hits));
    await env.DB.batch(stmts);
    return json({ ok: true, rows: parsed.length }, 201);
  }

  const all = await rows();
  const meta = await env.DB.prepare("SELECT main, hits, updated_at FROM board_meta WHERE owner = ? AND repo = ?").bind(owner, repo).first() as { main: string; hits: string; updated_at: number } | null;
  const q = new URL(req.url).searchParams;
  const n = Number(q.get("pr"));
  if (n) {
    const a = ask(n, all);
    return a ? json(a) : json({ error: "not on the board" }, 404);
  }
  if (/^(1|true)$/.test(q.get("brief") ?? "")) return json({ brief: brief(all).join("\n") });
  const fields = q.get("fields")?.split(",").map((f) => f.trim()).filter(Boolean);
  if (fields?.length) return json({ main: meta?.main ?? null, prs: pick(all, fields), mergeable: canMerge(all) });
  return json({
    main: meta?.main ?? null, at: meta?.updated_at ?? null, prs: all,
    waves: waves(all), mergeable: canMerge(all), hits: hitRate(JSON.parse(meta?.hits ?? "{}") as Hits),
  });
}
