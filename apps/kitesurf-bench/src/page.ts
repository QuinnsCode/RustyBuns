// The bench's one page: Run walks every site and action through /cell, one cell at a time, and fills the table.
// Burst sends many calls at once to each engine in turn; Screenshots shows both engines' picture of one page.
// Copy hands the raw runs over as JSON (paste them into an issue, or back to an agent).
import { DOLLARS_PER_BROWSER_HOUR } from "./bench.ts";

export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kitesurf Bench</title>
<style>
:root { --bg:#fff; --fg:#1b1f24; --muted:#5b6470; --line:#d9dde3; --surface:#f6f7f9; --accent:#e8590c; --bad:#b42318; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --fg:#e8ebef; --muted:#9aa4b1; --line:#2a3038; --surface:#171b21; --accent:#ff7a2f; --bad:#ff6b5e; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, sans-serif; padding:32px max(16px, env(safe-area-inset-left)); }
main { max-width:1000px; margin:0 auto; display:flex; flex-direction:column; gap:20px; }
h1 { margin:0; font-size:1.7rem; }
p { margin:0; color:var(--muted); max-width:70ch; }
.bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
button { font:inherit; font-weight:600; border:2px solid var(--fg); background:var(--fg); color:var(--bg); border-radius:999px; padding:8px 18px; cursor:pointer; }
button.ghost { background:transparent; color:var(--fg); }
button:disabled { opacity:.5; cursor:default; }
label { color:var(--muted); }
select { font:inherit; padding:4px 8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--fg); }
#status { font-variant-numeric:tabular-nums; color:var(--muted); }
.wrap { overflow-x:auto; border:1px solid var(--line); border-radius:12px; }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
th, td { padding:8px 12px; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align:left; }
thead th { background:var(--surface); font-size:.8rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
td.k { color:var(--accent); font-weight:600; }
td.err { color:var(--bad); text-align:left; white-space:normal; max-width:280px; font-size:.85rem; }
tfoot td { font-weight:700; background:var(--surface); }
h2 { margin:12px 0 0; font-size:1.2rem; }
.shots { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px; }
.shots figure { margin:0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--surface); }
.shots img { display:block; width:100%; height:auto; }
.shots figcaption { padding:8px 12px; color:var(--muted); font-size:.9rem; }
</style></head><body><main>
<h1>Kitesurf bench</h1>
<p>Each row runs one Quick Action on one of our live pages, with Kitesurf and Chromium taking turns. Times are medians, measured from inside this Worker: from the call to the last byte. "Browser ms" is the browser time Cloudflare reports, when it sends one. "$ / 1,000" is that browser time at Chromium's price, $${DOLLARS_PER_BROWSER_HOUR} a browser hour: Kitesurf has no price yet (free in beta), so its column says what it would cost if it were billed the same way.</p>
<div class="bar">
  <button id="run">Run the bench</button>
  <label for="reps">Turns per engine</label>
  <select id="reps"><option>1</option><option>2</option><option selected>3</option><option>5</option></select>
  <button id="copy" class="ghost" disabled>Copy results</button>
  <span id="status">Not run yet.</span>
</div>
<div class="wrap"><table>
  <thead><tr><th>Site</th><th>Action</th><th>Kitesurf ms</th><th>Chromium ms</th><th>Kitesurf / Chromium</th><th>Kitesurf browser ms</th><th>Chromium browser ms</th><th>$ / 1,000 (K / C)</th><th>Failed (K / C)</th><th>Error</th></tr></thead>
  <tbody id="rows"></tbody>
  <tfoot id="foot"></tfoot>
</table></div>
<h2>Burst</h2>
<p>Many calls at once on one page, Kitesurf first and then Chromium, never both together. A lighter engine should hold up better under load: watch "all done" and the failures.</p>
<div class="bar">
  <label for="bsite">Page</label><select id="bsite"></select>
  <label for="baction">Action</label><select id="baction"></select>
  <label for="bn">Calls at once</label><select id="bn"><option>5</option><option selected>10</option><option>20</option></select>
  <button id="burst">Burst</button>
  <span id="bstatus"></span>
</div>
<div class="wrap"><table>
  <thead><tr><th>Engine</th><th>Calls</th><th>All done ms</th><th>Median per call ms</th><th>Median browser ms</th><th>Failed</th><th>Error</th></tr></thead>
  <tbody id="brows"></tbody>
</table></div>
<h2>Screenshots</h2>
<p>The same page from each engine, to see what each one draws. Skate Tech Park is the WebGL case.</p>
<div class="bar">
  <label for="ssite">Page</label><select id="ssite"></select>
  <button id="shots">Show screenshots</button>
  <span id="sstatus"></span>
</div>
<div class="shots" id="shotbox"></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (n) => n == null ? "–" : Math.round(n).toLocaleString("en-US");
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let results = [];
const isSide = (x) => !!x && typeof x === "object" && Array.isArray(x.runs) && typeof x.failed === "number";
const isCell = (x) => !!x && typeof x === "object" && typeof x.site === "string" && typeof x.action === "string" && isSide(x.kitesurf) && isSide(x.chromium);
const RATE = ${DOLLARS_PER_BROWSER_HOUR};
const usd = (ms) => ms == null ? "–" : "$" + (ms * 1000 / 3600000 * RATE).toFixed(3);
let bursts = [];
const errorOf = (x) => x && typeof x === "object" && typeof x.error === "string" ? x.error : null;
function row(c) {
  const k = c.kitesurf, ch = c.chromium;
  const ratio = k.medianMs != null && ch.medianMs ? (k.medianMs / ch.medianMs).toFixed(2) + "×" : "–";
  const err = k.error ? "Kitesurf: " + k.error : ch.error ? "Chromium: " + ch.error : "";
  return "<tr><td>" + esc(c.site) + "</td><td>" + c.action + "</td><td class=k>" + fmt(k.medianMs) + "</td><td>" + fmt(ch.medianMs) + "</td><td>" + ratio +
    "</td><td>" + fmt(k.medianBrowserMs) + "</td><td>" + fmt(ch.medianBrowserMs) + "</td><td>" + usd(k.medianBrowserMs) + " / " + usd(ch.medianBrowserMs) + "</td><td>" + k.failed + " / " + ch.failed + "</td><td class=err>" + esc(err) + "</td></tr>";
}
function foot() {
  const rows = [];
  for (const a of ["content", "markdown", "screenshot"]) {
    const cs = results.filter((c) => c.action === a);
    if (!cs.length) continue;
    const k = med(cs.map((c) => c.kitesurf.medianMs)), ch = med(cs.map((c) => c.chromium.medianMs));
    rows.push("<tr><td>All sites</td><td>" + a + "</td><td>" + fmt(k) + "</td><td>" + fmt(ch) + "</td><td>" + (k != null && ch ? (k / ch).toFixed(2) + "×" : "–") + "</td><td colspan=5></td></tr>");
  }
  $("foot").innerHTML = rows.join("");
}
$("run").onclick = async () => {
  $("run").disabled = true; $("copy").disabled = true; results = []; $("rows").innerHTML = ""; $("foot").innerHTML = "";
  const reps = $("reps").value;
  const list = await fetch("/sites").then((r) => r.json()).catch(() => null);
  if (!list || !Array.isArray(list.sites) || !Array.isArray(list.actions)) { $("status").textContent = "The bench could not load its page list."; $("run").disabled = false; return; }
  const { sites, actions } = list;
  const total = sites.length * actions.length; let done = 0; const t0 = Date.now();
  for (let s = 0; s < sites.length; s++) for (const a of actions) {
    $("status").textContent = "Running " + sites[s].name + " / " + a + " (" + (done + 1) + " of " + total + ")";
    const r = await fetch("/cell?site=" + s + "&action=" + a + "&reps=" + reps);
    const c = await r.json().catch(() => null);
    if (!r.ok || !isCell(c)) { $("status").textContent = errorOf(c) || "The bench stopped: " + r.status; $("run").disabled = false; return; }
    results.push(c); $("rows").insertAdjacentHTML("beforeend", row(c)); foot(); done++;
  }
  $("status").textContent = "Done: " + total + " rows in " + Math.round((Date.now() - t0) / 1000) + " s.";
  $("run").disabled = false; $("copy").disabled = false;
};
$("copy").onclick = async () => {
  const text = JSON.stringify({ ranAt: new Date().toISOString(), results, bursts }, null, 1);
  try { await navigator.clipboard.writeText(text); $("status").textContent = "Copied " + results.length + " rows and " + bursts.length + " bursts as JSON."; }
  catch { $("status").textContent = "Copy was blocked; the JSON is in the console."; console.log(text); }
};
fetch("/sites").then((r) => r.json()).then((list) => {
  if (!list || !Array.isArray(list.sites) || !Array.isArray(list.actions)) return;
  const opts = (pick) => list.sites.map((x, i) => "<option value=" + i + (i === pick ? " selected" : "") + ">" + esc(x.name) + "</option>").join("");
  const webgl = list.sites.findIndex((x) => /WebGL/.test(x.name));
  $("bsite").innerHTML = opts(0); $("ssite").innerHTML = opts(webgl < 0 ? 0 : webgl);
  $("baction").innerHTML = list.actions.map((a) => "<option>" + esc(a) + "</option>").join("");
}).catch(() => {});
const isBurst = (x) => !!x && typeof x === "object" && typeof x.wallMs === "number" && typeof x.n === "number" && isSide(x.side);
function burstRow(name, b) {
  return "<tr><td>" + name + "</td><td>" + b.n + "</td><td" + (name === "Kitesurf" ? " class=k" : "") + ">" + fmt(b.wallMs) + "</td><td>" + fmt(b.side.medianMs) + "</td><td>" + fmt(b.side.medianBrowserMs) +
    "</td><td>" + b.side.failed + "</td><td class=err>" + esc(b.side.error || "") + "</td></tr>";
}
$("burst").onclick = async () => {
  $("burst").disabled = true; $("bstatus").textContent = "Running…";
  const r = await fetch("/burst?site=" + $("bsite").value + "&action=" + $("baction").value + "&n=" + $("bn").value);
  const b = await r.json().catch(() => null);
  $("burst").disabled = false;
  if (!r.ok || !b || !isBurst(b.kitesurf) || !isBurst(b.chromium)) { $("bstatus").textContent = errorOf(b) || "The burst stopped: " + r.status; return; }
  bursts.push(b); $("copy").disabled = false;
  $("brows").insertAdjacentHTML("beforeend", "<tr><td colspan=7>" + esc(b.site) + " / " + esc(b.action) + "</td></tr>" + burstRow("Kitesurf", b.kitesurf) + burstRow("Chromium", b.chromium));
  $("bstatus").textContent = "Done.";
};
$("shots").onclick = async () => {
  $("shots").disabled = true; $("sstatus").textContent = "Taking both…"; $("shotbox").innerHTML = "";
  const site = $("ssite").value;
  for (const [engine, name] of [["kitesurf", "Kitesurf"], ["chromium", "Chromium"]]) {
    const r = await fetch("/shot?site=" + site + "&engine=" + engine).catch(() => null);
    const fig = document.createElement("figure");
    if (r && r.ok) {
      const blob = await r.blob(); const img = document.createElement("img");
      img.src = URL.createObjectURL(blob); img.alt = name + " screenshot"; fig.append(img);
      fig.insertAdjacentHTML("beforeend", "<figcaption>" + name + " · " + fmt(blob.size / 1024) + " KB</figcaption>");
    } else fig.insertAdjacentHTML("beforeend", "<figcaption>" + name + ": " + esc(r ? (await r.text()).slice(0, 300) : "no answer") + "</figcaption>");
    $("shotbox").append(fig);
  }
  $("shots").disabled = false; $("sstatus").textContent = "";
};
</script></body></html>`;
