// GET/POST /api/repos/:o/:r/board: the live board (#1524, board.ts). The live process (scripts/mervin-live.ts) posts
// the rows of the PRs whose stage moved; readers get every row with the waves, who can merge now, and the tiers'
// hit rates. `?pr=N` answers for one PR: what blocks it, who should take it, what it blocks.

import { parseJson } from "./util.ts";
import type { Env } from "./env.ts";
import { json, need, readBody } from "./env.ts";
import { arr, Bad, bool, int, obj, opt, raw, str } from "@rustybuns/util/guard";
import { ask, brief, canMerge, pick, hitRate, parseRow, waves, type BoardRow, type Hits } from "./board.ts";

const MAX_ROWS = 500, MAX_HITS = 4000;

export async function boardRoutes(req: Request, env: Env, owner: string, repo: string, write: boolean): Promise<Response> {
  const rows = async () => ((await env.DB.prepare("SELECT row, updated_at FROM board_prs WHERE owner = ? AND repo = ? ORDER BY pr").bind(owner, repo).all<{ row: string; updated_at: number }>()).results)
    .flatMap((r) => { const row = parseJson<BoardRow | null>(r.row, null); return row ? [{ ...row, at: r.updated_at }] : []; });

  if (req.method === "POST") {
    if (!write) return json({ error: "no write access" }, 403);
    const row = (x: unknown) => { const r = parseRow(x); if (typeof r === "string") throw new Bad(r); return r; };
    const b = need(await readBody(req), obj({ main: str(), prs: arr(row, MAX_ROWS), drop: opt(arr(int(0, Infinity), MAX_ROWS)), replace: opt(bool()), hits: raw }));
    if (b instanceof Response) return b;
    const parsed = b.prs;
    const now = Date.now();
    const gone = b.replace ? (await rows()).map((r) => r.pr).filter((n) => !parsed.some((p) => p.pr === n)) : [];
    const stmts = [
      ...parsed.map((r) => env.DB.prepare("INSERT INTO board_prs (owner, repo, pr, row, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, repo, pr) DO UPDATE SET row = excluded.row, updated_at = excluded.updated_at")
        .bind(owner, repo, r.pr, JSON.stringify(r), now)),
      ...[...(b.drop ?? []), ...gone].map((n) => env.DB.prepare("DELETE FROM board_prs WHERE owner = ? AND repo = ? AND pr = ?").bind(owner, repo, n)),
    ];
    const hits = b.hits && typeof b.hits === "object" && !Array.isArray(b.hits) ? JSON.stringify(b.hits) : null;
    if (hits && hits.length > MAX_HITS) return json({ error: `hits: up to ${MAX_HITS} characters` }, 400);
    stmts.push(env.DB.prepare("INSERT INTO board_meta (owner, repo, main, hits, updated_at) VALUES (?, ?, ?, COALESCE(?, '{}'), ?) ON CONFLICT (owner, repo) DO UPDATE SET main = excluded.main, hits = COALESCE(?, board_meta.hits), updated_at = excluded.updated_at")
      .bind(owner, repo, b.main, hits, now, hits));
    await env.DB.batch(stmts);
    return json({ ok: true, rows: parsed.length }, 201);
  }

  const all = await rows();
  const meta = await env.DB.prepare("SELECT main, hits, updated_at FROM board_meta WHERE owner = ? AND repo = ?").bind(owner, repo).first<{ main: string; hits: string; updated_at: number }>();
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
    waves: waves(all), mergeable: canMerge(all), hits: hitRate(parseJson<Hits>(meta?.hits, {})),
  });
}
