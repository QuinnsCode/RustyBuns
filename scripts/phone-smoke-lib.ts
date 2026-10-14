// Phone smoke, the pure half: the phones, what the in-page audit returns, how it turns into findings, and
// the triage board. No browser here, so it tests without one (phone-smoke.test.ts); phone-smoke.ts drives Chrome.
import { esc, plural } from "../apps/codesplitter/src/util.ts";

export const PHONES = [
  { name: "iPhone SE", w: 375, h: 667 },
  { name: "iPhone 15", w: 393, h: 852 },
  { name: "iPhone 15 Pro Max", w: 430, h: 932 },
  { name: "Pixel 8", w: 412, h: 915 },
  { name: "Galaxy S23", w: 360, h: 780 },
] as const;
/** What a phone is compared against: the same page at laptop width. */
export const REFERENCE = { name: "Desktop", w: 1280, h: 800 } as const;

export type Control = { tag: string; label: string; x: number; y: number; w: number; h: number; shown: boolean; obscured: boolean };
export type Audit = { vw: number; vh: number; scrollW: number; viewportMeta: boolean; textLen: number; canvases: number; controls: Control[] };
export type Finding = { kind: string; sev: "error" | "warn"; detail: string };
export type PhoneResult = { phone: string; w: number; h: number; shot?: string; findings: Finding[] };
export type AppResult = { app: string; bootError?: string; phones: PhoneResult[] };
export type Report = { generatedAt: string; apps: AppResult[] };

/** Runs inside the page (stringified): every control the user could tap, where it is and whether it is really there. */
export function pageAudit(): Audit {
  const vw = innerWidth, vh = innerHeight;
  const sel = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[onclick]';
  // A text field's value is what someone typed (or a random default name), never its label.
  const label = (el: Element) => {
    const f = el as HTMLInputElement;
    const own = el.tagName === "INPUT" && !/^(button|submit|reset)$/.test(f.type) ? "" : f.value;
    return (el.getAttribute("aria-label") || f.labels?.[0]?.innerText || (el as HTMLElement).innerText || own || el.getAttribute("title") ||
      el.querySelector("img[alt]")?.getAttribute("alt") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
  };
  const controls = [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const shown = r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.01;
    let obscured = false;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (shown && !(el instanceof SVGElement) && cx >= 0 && cx < vw && cy >= 0 && cy < vh) {
      const top = document.elementFromPoint(cx, cy);
      obscured = !!top && top !== el && !el.contains(top) && !top.contains(el);
    }
    return { tag: el.tagName.toLowerCase(), label: label(el), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), shown, obscured };
  });
  return {
    vw, vh, scrollW: document.documentElement.scrollWidth, viewportMeta: !!document.querySelector('meta[name="viewport"]'),
    textLen: (document.body?.innerText ?? "").trim().length, canvases: document.querySelectorAll("canvas").length, controls,
  };
}

const count = (cs: Control[]) => {
  const m = new Map<string, number>();
  for (const c of cs) if (c.shown && c.label) m.set(c.label, (m.get(c.label) ?? 0) + 1);
  return m;
};

/** The findings for one phone: layout breaks, controls that are cut off, covered or gone, and noise from the page. */
export function analyze(phone: Audit, ref: Audit | undefined, noise: string[] = []): Finding[] {
  const out: Finding[] = [];
  const add = (kind: string, sev: Finding["sev"], detail: string) => out.push({ kind, sev, detail });
  const blank = (a: Audit) => a.textLen < 20 && a.canvases === 0 && a.controls.every((c) => !c.shown);
  // Blank at laptop width too means the page needs something this run lacks (a desktop host), not a phone regression.
  if (blank(phone)) add("blank", ref && blank(ref) ? "warn" : "error", ref && blank(ref) ? "blank on the laptop page too: does it need its desktop host?" : "nothing rendered: no text, no canvas, no controls");
  if (phone.scrollW > phone.vw + 1) add("h-overflow", "error", `page is ${phone.scrollW}px wide in a ${phone.vw}px screen`);
  if (!phone.viewportMeta) add("no-viewport-meta", "warn", "no <meta name=viewport>, a phone may render it as a zoomed-out desktop page");
  const shown = phone.controls.filter((c) => c.shown);
  for (const c of shown) {
    const name = `${c.tag} "${c.label || "(no label)"}"`;
    if (c.x < -2 || c.x + c.w > phone.vw + 2) add("cut-off", "error", `${name} spans ${c.x}..${c.x + c.w}px of ${phone.vw}`);
    if (c.obscured) add("covered", "error", `${name} at ${c.x},${c.y} has something on top of it`);
    if (!c.label) add("unlabeled", "warn", `${c.tag} at ${c.x},${c.y} has no text, aria-label or title`);
    else if (/^(button|input|select)$/.test(c.tag) && Math.min(c.w, c.h) < 24) add("tiny-target", "warn", `${name} is ${c.w}x${c.h}px, under the 24px minimum`);
  }
  if (ref) {
    const have = count(phone.controls);
    for (const [label, n] of count(ref.controls)) {
      const got = have.get(label) ?? 0;
      if (got < n) add("missing-vs-desktop", "error", `"${label}" is on the laptop page${n > 1 ? ` ${n} times` : ""} and ${got ? `${got} on the phone` : "gone on the phone"}`);
    }
  }
  for (const n of noise) add("console", "warn", n);
  return out;
}

export type Status = "error" | "warn" | "ok";
export const worst = (fs: Finding[]): Status => (fs.some((f) => f.sev === "error") ? "error" : fs.length ? "warn" : "ok");
const RANK = { error: 0, warn: 1, ok: 2 } as const;
export const appStatus = (a: AppResult): Status =>
  a.bootError ? "error" : a.phones.map((p) => worst(p.findings)).reduce<Status>((s, w) => (RANK[w] < RANK[s] ? w : s), "ok");

/** Joins the reports of several shards (one per ephemeral runner) into one, keeping the app names unique. */
export function mergeReports(rs: Report[]): Report {
  const apps = new Map<string, AppResult>();
  for (const r of rs) for (const a of r.apps) apps.set(a.app, a);
  return { generatedAt: rs.map((r) => r.generatedAt).sort().at(-1) ?? new Date().toISOString(), apps: [...apps.values()] };
}

/** Assigns apps to shard i of n by position, so every runner picks the same split without talking. */
export const shardOf = <T>(xs: T[], i: number, n: number) => xs.filter((_, k) => k % n === i - 1);

/** The triage board: worst apps first, one thumbnail per phone, findings underneath. Shots are paths beside the file. */
export function board(r: Report): string {
  const apps = [...r.apps].sort((a, b) => RANK[appStatus(a)] - RANK[appStatus(b)] || a.app.localeCompare(b.app));
  const n = (s: string) => apps.filter((a) => appStatus(a) === s).length;
  const rows = apps.map((a) => {
    const st = appStatus(a);
    const total = a.phones.reduce((s, p) => s + p.findings.length, 0);
    const tiles = a.phones.map((p) => {
      const w = worst(p.findings);
      const img = p.shot ? `<img loading="lazy" src="${esc(p.shot)}" alt="${esc(a.app)} on ${esc(p.phone)}">` : `<div class="none">no shot</div>`;
      const list = p.findings.length
        ? `<ul>${p.findings.map((f) => `<li class="${f.sev}"><b>${esc(f.kind)}</b> ${esc(f.detail)}</li>`).join("")}</ul>`
        : `<p class="clean">clean</p>`;
      return `<figure class="${w}"><a href="${esc(p.shot ?? "#")}">${img}</a><figcaption><span>${esc(p.phone)}</span><i>${p.w}x${p.h}</i>` +
        `<em>${p.findings.length ? plural(p.findings.length, "finding") : "ok"}</em></figcaption><details><summary>details</summary>${list}</details></figure>`;
    }).join("");
    const body = a.bootError ? `<pre class="boot">${esc(a.bootError)}</pre>` : `<div class="strip">${tiles}</div>`;
    return `<section class="${st}" data-status="${st}"><h2><span class="dot"></span>${esc(a.app)}<small>${a.bootError ? "did not finish" : plural(total, "finding")}</small></h2>${body}</section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone smoke</title><style>
:root{--bg:#fff;--fg:#1f2328;--mut:#656d76;--line:#d0d7de;--err:#cf222e;--warn:#bc4c00;--ok:#1a7f37;--card:#f6f8fa}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--line:#30363d;--err:#ff7b72;--warn:#ffa657;--ok:#3fb950;--card:#161b22}}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:16px}h1{font-size:20px;margin:0 12px 0 0}
.pill{border:1px solid var(--line);border-radius:999px;padding:2px 10px;white-space:nowrap}.pill.error{color:var(--err)}.pill.warn{color:var(--warn)}.pill.ok{color:var(--ok)}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:4px 12px;cursor:pointer}
section{border:1px solid var(--line);border-radius:8px;margin-bottom:16px;padding:12px;background:var(--card)}
h2{margin:0 0 10px;font-size:16px;display:flex;align-items:center;gap:8px}h2 small{color:var(--mut);font-weight:400}
.dot{width:10px;height:10px;border-radius:50%;background:var(--ok)}.error .dot{background:var(--err)}.warn .dot{background:var(--warn)}
.strip{display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding-bottom:6px}
figure{margin:0;flex:0 0 190px;border:1px solid var(--line);border-radius:6px;background:var(--bg);overflow:hidden}
figure.error{border-color:var(--err)}figure.warn{border-color:var(--warn)}
figure img{display:block;width:100%;height:auto}.none{padding:40px 8px;text-align:center;color:var(--mut)}
figcaption{display:flex;justify-content:space-between;gap:6px;padding:6px 8px;font-size:12px;white-space:nowrap}figcaption i{color:var(--mut);font-style:normal}figcaption em{font-style:normal;color:var(--mut)}
details{padding:0 8px 8px;font-size:12px}ul{padding-left:16px;margin:6px 0}li.error b{color:var(--err)}li.warn b{color:var(--warn)}.clean{color:var(--ok);margin:6px 0}
.boot{white-space:pre-wrap;color:var(--err);margin:0}.hide-ok section.ok{display:none}
</style></head><body><header><h1>Phone smoke</h1><span class="pill error">${n("error")} broken</span><span class="pill warn">${n("warn")} to look at</span><span class="pill ok">${n("ok")} clean</span>
<span class="pill">${apps.length} apps x ${PHONES.length} phones</span><span class="pill">${esc(r.generatedAt.slice(0, 16).replace("T", " "))} UTC</span>
<button onclick="document.body.classList.toggle('hide-ok')">Hide clean apps</button></header>
${rows}</body></html>`;
}
