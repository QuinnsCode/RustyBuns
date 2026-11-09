// The Agent Office's 3D client, served by this Worker at /office/ (#3423 slice 2, office-preview only).
//
// Agent Office is by WebDevCody (https://github.com/AgentSystemLabs/agent-office, MIT); apps/agent-office
// Rusty Buns-ifies its release and skins it as the Druids grove. Its client was written for its own server at the
// root of a host: it loads /assets/*, opens /ws and calls /api/*. Here it shares a host with codeSplitter, so the
// copy below moves it under /office/ and points its socket and calls at the floor's routes (office.ts):
//   /assets/, /druids/, /favicon.svg   -> /office/...           (and Vite's preload base, "/"+dep)
//   ${location.host}/ws?               -> /api/office/ws?       (the floor comes in ?floor=, as upstream sends it)
//   /api/                              -> /api/office/          (whoami answers; the rest of upstream's API 404s)
//   /login                             -> codeSplitter's home, whose Sign in button is the way in
// Each rewrite must find its target, so a release that moves one fails the build instead of shipping a broken page.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const TEXT = /\.(html|js|mjs|css|json|svg)$/;
const Q = "[\"'`]";

/** The rewrites, each with how many files must contain it at least once (0 = it may be missing). */
export const REWRITES: { name: string; from: RegExp; to: string; need: number }[] = [
  { name: "assets", from: new RegExp(`(${Q})/(assets|druids)/`, "g"), to: "$1/office/$2/", need: 1 },
  { name: "favicon", from: new RegExp(`(${Q})/favicon\\.svg`, "g"), to: "$1/office/favicon.svg", need: 1 },
  { name: "preload base", from: /return"\/"\+([a-zA-Z_$][\w$]*)/g, to: 'return"/office/"+$1', need: 1 },
  { name: "socket", from: /\$\{location\.host\}\/ws\?/g, to: "${location.host}/api/office/ws?", need: 1 },
  { name: "api", from: new RegExp(`(${Q})/api/`, "g"), to: "$1/api/office/", need: 1 },
  { name: "login", from: new RegExp(`(${Q})/login(\\?next=[^"'\`]*)?(?=${Q})`, "g"), to: "$1/", need: 1 },
];

/** One text file's rewrites, and which of them hit. */
export function rewrite(body: string): { body: string; hit: Set<string> } {
  const hit = new Set<string>();
  for (const r of REWRITES) body = body.replace(r.from, (...m) => { hit.add(r.name); return r.to.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? ""); });
  return { body, hit };
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/** Copy a prepared office's dist/public to `to` (dist/client/office), rewritten, with its licence and credit beside it. */
export function copyOfficeClient(office: string, to: string) {
  const pub = path.join(office, "dist/public");
  if (!existsSync(path.join(pub, "index.html"))) throw new Error(`${pub} has no index.html: run \`bun scripts/rustybunsify.ts\` in apps/agent-office first`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(pub, to, { recursive: true });
  const hits = new Map<string, number>();
  for (const f of walk(to).filter((f) => TEXT.test(f))) {
    const before = readFileSync(f, "utf8"), { body, hit } = rewrite(before);
    for (const h of hit) hits.set(h, (hits.get(h) ?? 0) + 1);
    if (body !== before) writeFileSync(f, body);
  }
  const missed = REWRITES.filter((r) => (hits.get(r.name) ?? 0) < r.need).map((r) => r.name);
  if (missed.length) throw new Error(`the office client moved: no file had the ${missed.join(", ")} path to rewrite (src/office-client.ts)`);
  // MIT asks for the notice to travel with the code.
  cpSync(path.join(office, "LICENSE"), path.join(to, "LICENSE.txt"));
  const index = path.join(to, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace("</body>", () => `${CREDIT}</body>`));
  writeFileSync(path.join(to, "credits.html"), CREDITS_PAGE);
  return { files: walk(to).length, hits };
}

/** The stage that serves the office; every other build leaves it out. */
export const OFFICE_STAGE = "office-preview";

/**
 * build.ts's step: on the office stage, prepare the office (apps/agent-office, the pinned release, cached after the
 * first time) and copy it to dist/client/office; on any other, remove a copy an earlier build left, so a live deploy
 * never carries it. True when the office is in.
 */
export async function officeClientFor(stage: string | undefined, app = path.join(import.meta.dir, "..")) {
  const to = path.join(app, "dist/client/office");
  if (stage !== OFFICE_STAGE) { rmSync(to, { recursive: true, force: true }); return false; }
  const agentOffice = path.join(app, "../agent-office");
  const r = Bun.spawnSync(["bun", "scripts/rustybunsify.ts"], { cwd: agentOffice, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error("preparing the office (apps/agent-office: bun scripts/rustybunsify.ts) failed");
  const { files } = copyOfficeClient(path.join(agentOffice, "office"), to);
  console.log(`office: Agent Office's client at /office/, ${files} files`);
  return true;
}

/** Where the office came from: its maker, the project as it was, our port of it, and its place here. */
export const CREDITS = {
  maker: { name: "WebDevCody", links: [
    ["GitHub", "https://github.com/webdevcody"], ["YouTube", "https://www.youtube.com/@webdevcody"],
    ["X", "https://x.com/webdevcody"], ["Website", "https://webdevcody.com"],
  ] },
  original: "https://github.com/AgentSystemLabs/agent-office",
  port: "https://github.com/QuinnsCode/RustyBuns/tree/main/apps/agent-office",
  here: "https://github.com/QuinnsCode/RustyBuns/blob/main/apps/agent-office/MOVE.md",
} as const;

/** The corner credit on the office page, clear of the office's own buttons. */
export const CREDIT = `<a href="/office/credits.html" style="position:fixed;right:10px;bottom:6px;z-index:9;font:12px system-ui,sans-serif;color:#fff;opacity:.75;text-decoration:none;text-shadow:0 1px 2px #000">Agent Office, made by WebDevCody</a>`;

const a = (href: string, text: string) => `<a href="${href}">${text}</a>`;
const CREDITS_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Office credits</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2328;background:#fff}
h1{font-size:24px}h2{font-size:17px;margin-top:28px}a{color:#e8590c}ol{padding-left:20px}li{margin:8px 0}
@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}}</style></head>
<body>
<h1>Agent Office, made by WebDevCody</h1>
<p>We use Agent Office, made by WebDevCody, heavily modified to suit my own use case. My beautiful Frankenstein.</p>
<p>WebDevCody: ${CREDITS.maker.links.map(([n, u]) => a(u, n)).join(" · ")}</p>
<h2>Where this office comes from</h2>
<ol>
<li><strong>Agent Office, as it was.</strong> WebDevCody's cartoon 3D office where Claude Code workers sit at desks: ${a(CREDITS.original, "AgentSystemLabs/agent-office")} (MIT, ${a("/office/LICENSE.txt", "its licence")}).</li>
<li><strong>Our port.</strong> Rusty Buns runs its release on Bun as one file for Mac and Linux, with nothing forked, and dresses it as the Druids grove: ${a(CREDITS.port, "apps/agent-office")}.</li>
<li><strong>Inside codeSplitter.</strong> This page: the same client, served by codeSplitter's Worker on a preview, with the floor's queue and desks kept in a Durable Object (${a(CREDITS.here, "the plan")}).</li>
</ol>
<p>${a("/office/", "Back to the office")}</p>
</body></html>
`;

