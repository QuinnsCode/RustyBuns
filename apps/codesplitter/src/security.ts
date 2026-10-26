// What keeps a browser and a bot honest, before any route runs (#647):
//   headers    every answer, the Worker's here and the static pages' through dist/client/_headers
//              (build.ts writes it from the same list): no framing, no sniffing, HTTPS only, and an
//              enforced Content-Security-Policy (#673). Inline scripts run only by hash: the build
//              hashes the pages' own, and the Worker's answers have none.
//   origin     a cookie-signed POST, PUT, PATCH or DELETE to /api from another site is refused.
//              SameSite=Lax was all that stood in a cross-site form's way. Bearer tokens are exempt:
//              no browser attaches one on its own.
//   turnstile  Cloudflare's bot check on sign-up, password reset and joining a crew as a person,
//              when the site has TURNSTILE_SECRET. The page sends the widget's answer as x-turnstile.
//   edge limit AUTH_LIMIT, Workers Rate Limiting, counts the per-IP rules (signing in and up, account
//              mail, ...) in memory at each location before D1's counters write a row (limits.ts).

import { createHash } from "node:crypto";
import { json, type Env } from "./env.ts";

/** Turnstile's script and its iframe come from here. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// What the pages load: their own inline scripts (by hash) and styles, the vendored scripts and fonts,
// images from anywhere (avatars, data: and blob: previews), and the file sockets on this host.
export const csp = (scriptHashes: string[] = [], pagesOrigin = "") => [
  "default-src 'self'",
  ["script-src 'self'", ...scriptHashes.map((h) => `'${h}'`), TURNSTILE_ORIGIN].join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  `frame-src 'self' blob: ${TURNSTILE_ORIGIN} ${pagesOrigin}`.trim(),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** The Worker's own answers: JSON, redirects and share cards, none with an inline script. */
export const CSP = csp();

/** sha256-… of each inline <script> in a page (the importmap too), as script-src takes them. */
export const inlineScriptHashes = (html: string) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(([, body]) => `sha256-${createHash("sha256").update(body!).digest("base64")}`);

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/** The static pages' copy of the headers, in Cloudflare's _headers format, with their inline scripts' hashes. */
export const headersFile = (scriptHashes: string[] = [], pagesOrigin = "") =>
  `/*\n${Object.entries({ ...SECURITY_HEADERS, "content-security-policy": csp(scriptHashes, pagesOrigin) }).map(([k, v]) => `  ${k}: ${v}`).join("\n")}\n`;

/** `res` with the headers it doesn't set itself (the OAuth consent page has its own, stricter CSP). A socket's 101 is left be. */
export function secured(res: Response): Response {
  if (res.status === 101 || (res as { webSocket?: unknown }).webSocket) return res;
  const missing = Object.entries(SECURITY_HEADERS).filter(([k]) => !res.headers.has(k));
  if (!missing.length) return res;
  // A Response from a fetch or a Durable Object has immutable headers: copy it then.
  try { for (const [k, v] of missing) res.headers.set(k, v); return res; }
  catch { const out = new Response(res.body, res); for (const [k, v] of missing) out.headers.set(k, v); return out; }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `origin` is this site. Behind an HTTPS tunnel (Tailscale Serve, cloudflared) to the desktop a
 * request arrives as http://<host> while the browser says https://<host>: the same host, over a
 * stronger scheme, so it counts (#456). Never the other way round.
 */
export const ownOrigin = (origin: string, url: URL) => origin === url.origin || (url.protocol === "http:" && origin === `https://${url.host}`);

/** A cookie-signed write from another site: refuse it. A socket upgrade is a GET that acts as the person (edits a file, plays as them), so it counts as a write. Without an Origin header, Sec-Fetch-Site says; with neither, it isn't a browser. */
export function crossSite(req: Request, env: Env): Response | null {
  const socket = req.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (!(UNSAFE.has(req.method) || socket) || !req.headers.get("cookie")) return null;
  if (/^(Bearer|token)\s/i.test(req.headers.get("authorization") ?? "")) return null;
  const origin = req.headers.get("origin");
  const ours = (o: string) => ownOrigin(o, new URL(req.url)) || (!!env.BETTER_AUTH_URL && o === new URL(env.BETTER_AUTH_URL).origin);
  const foreign = origin ? !ours(origin) : req.headers.get("sec-fetch-site") === "cross-site";
  return foreign ? json({ error: "cross-site request refused: send it from this site, or with Authorization: Bearer" }, 403) : null;
}

/** Turnstile is on: the page shows the widget and these routes want its answer. */
export const turnstileOn = (env: Env) => !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY);

/** Making an account or asking for a reset link wants a Turnstile answer. So does joining a crew as a person, checked in invites.ts once the body says so. */
export const wantsTurnstile = (method: string, p: string[]) =>
  method === "POST" && p[1] === "auth" && (p[2] === "sign-up" || p[2] === "request-password-reset");

/** Turnstile's verdict on the answer this request carries, or a 403 saying why not. Off (null) without the keys. */
export async function turnstile(req: Request, env: Env): Promise<Response | null> {
  if (!turnstileOn(env)) return null;
  const answer = req.headers.get("x-turnstile");
  const refuse = (why: string) => json({ error: `bot check: ${why}` }, 403);
  if (!answer) return refuse("solve the check on the page and try again");
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET!);
  form.set("response", answer);
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) form.set("remoteip", ip);
  const go = (env.TURNSTILE_FETCH as typeof fetch | undefined) ?? fetch;
  try {
    const r = (await (await go(`${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`, { method: "POST", body: form })).json()) as { success?: boolean };
    return r.success ? null : refuse("it didn't pass; try it again");
  } catch { return refuse("couldn't reach Cloudflare to check it; try again"); }
}

/**
 * The edge's count for a per-IP rule, ahead of D1's: a 429 once this IP is over AUTH_LIMIT
 * in its minute. Only requests from the internet (cf-connecting-ip) are counted, as in limits.ts.
 */
export async function edgeLimit(req: Request, env: Env, rule: string): Promise<Response | null> {
  const ip = req.headers.get("cf-connecting-ip");
  if (!env.AUTH_LIMIT || !ip) return null;
  const { success } = await env.AUTH_LIMIT.limit({ key: `${rule}:${ip}` });
  return success ? null : json({ error: "too many tries from here; wait a minute" }, 429, { "retry-after": "60" });
}
