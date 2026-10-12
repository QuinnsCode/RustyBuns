// What GitHub Actions cost this month, for admins (GET /api/admin/actions, the
// Insights page's "GitHub Actions" box). Public repos on GitHub's standard
// runners are free; this is the check that it stays that way. It reads GitHub's
// billing usage report for the admin's own GitHub account, with their GitHub
// token (github.ts githubToken), and sums the Actions lines: minutes, what they'd
// cost, the discount (a public repo's minutes are discounted to nothing) and what's
// actually owed, per repo and per runner. A token that can't read billing (it
// needs the Plan permission, read) says so, with a link to the billing page.

import { githubToken } from "./github.ts";
import { json, type Env } from "./env.ts";

const API = "https://api.github.com";
export const BILLING_PAGE = "https://github.com/settings/billing";

interface Item { product?: string; sku?: string; quantity?: number; unitType?: string; grossAmount?: number; discountAmount?: number; netAmount?: number; repositoryName?: string }
interface Sum { minutes: number; gross: number; discount: number; net: number }
export type Bill =
  | { ok: true; login: string; month: string; total: Sum; repos: ({ repo: string } & Sum)[]; runners: ({ sku: string } & Sum)[] }
  | { ok: false; reason: string; link: string };

const zero = (): Sum => ({ minutes: 0, gross: 0, discount: 0, net: 0 });
const cents = (n: number) => Math.round(n * 100) / 100;
function add(s: Sum, i: Item) {
  if (/minute/i.test(i.unitType ?? "minutes")) s.minutes += i.quantity ?? 0;
  s.gross += i.grossAmount ?? 0; s.discount += i.discountAmount ?? 0; s.net += i.netAmount ?? 0;
}
const tidy = (s: Sum): Sum => ({ minutes: Math.round(s.minutes), gross: cents(s.gross), discount: cents(s.discount), net: cents(s.net) });

/** This month's Actions usage on the GitHub account `user` signed in with (or this host's token). */
export async function actionsBill(env: Env, user: string, now = new Date()): Promise<Bill> {
  const t = await githubToken(env, user).catch(() => null);
  if (!t) return { ok: false, reason: "no GitHub token: sign in with GitHub, or set GITHUB_TOKEN", link: BILLING_PAGE };
  const headers = { authorization: `Bearer ${t.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "codesplitter" };
  const me = await fetch(`${API}/user`, { headers });
  if (!me.ok) return { ok: false, reason: `GitHub said ${me.status} to who this token is`, link: BILLING_PAGE };
  const { login } = (await me.json()) as { login: string };
  const year = now.getUTCFullYear(), month = now.getUTCMonth() + 1;
  const r = await fetch(`${API}/users/${encodeURIComponent(login)}/settings/billing/usage?year=${year}&month=${month}`, { headers });
  if (!r.ok) {
    const why = r.status === 403 || r.status === 404 ? "this token can't read billing (it needs the Plan permission, read)" : `GitHub said ${r.status}`;
    return { ok: false, reason: why, link: BILLING_PAGE };
  }
  const items = (((await r.json()) as { usageItems?: Item[] }).usageItems ?? []).filter((i) => /actions/i.test(i.product ?? ""));
  const total = zero(), repos = new Map<string, Sum>(), runners = new Map<string, Sum>();
  for (const i of items) {
    add(total, i);
    const repo = i.repositoryName || "(no repo)", sku = i.sku || "(unknown)";
    add(repos.get(repo) ?? repos.set(repo, zero()).get(repo)!, i);
    add(runners.get(sku) ?? runners.set(sku, zero()).get(sku)!, i);
  }
  const list = <K extends string>(m: Map<string, Sum>, k: K) => [...m].map(([v, s]) => ({ [k]: v, ...tidy(s) }) as { [P in K]: string } & Sum).sort((a, b) => b.net - a.net || b.minutes - a.minutes);
  return { ok: true, login, month: `${year}-${String(month).padStart(2, "0")}`, total: tidy(total), repos: list(repos, "repo"), runners: list(runners, "sku") };
}

/** GET /api/admin/actions */
export async function actionsRoutes(req: Request, env: Env, p: string[], user: string | null, admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "actions" || p[3]) return null;
  if (!admin || !user) return json({ error: "admins only" }, 403);
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  return json(await actionsBill(env, user));
}
