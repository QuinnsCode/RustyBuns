// The bench's one page: Run walks every site and action through /cell, one cell at a time, and fills the table.
// Copy hands the raw runs over as JSON (paste them into an issue, or back to an agent).
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
</style></head><body><main>
<h1>Kitesurf bench</h1>
<p>Each row runs one Quick Action on one of our live pages, with Kitesurf and Chromium taking turns. Times are medians, measured from inside this Worker: from the call to the last byte. "Browser ms" is the browser time Cloudflare reports, when it sends one.</p>
<div class="bar">
  <button id="run">Run the bench</button>
  <label for="reps">Turns per engine</label>
  <select id="reps"><option>1</option><option>2</option><option selected>3</option><option>5</option></select>
  <button id="copy" class="ghost" disabled>Copy results</button>
  <span id="status">Not run yet.</span>
</div>
<div class="wrap"><table>
  <thead><tr><th>Site</th><th>Action</th><th>Kitesurf ms</th><th>Chromium ms</th><th>Kitesurf / Chromium</th><th>Kitesurf browser ms</th><th>Chromium browser ms</th><th>Failed (K / C)</th><th>Error</th></tr></thead>
  <tbody id="rows"></tbody>
  <tfoot id="foot"></tfoot>
</table></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (n) => n == null ? "–" : Math.round(n).toLocaleString("en-US");
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let results = [];
const isSide = (x) => !!x && typeof x === "object" && Array.isArray(x.runs) && typeof x.failed === "number";
const isCell = (x) => !!x && typeof x === "object" && typeof x.site === "string" && typeof x.action === "string" && isSide(x.kitesurf) && isSide(x.chromium);
const errorOf = (x) => x && typeof x === "object" && typeof x.error === "string" ? x.error : null;
function row(c) {
  const k = c.kitesurf, ch = c.chromium;
  const ratio = k.medianMs != null && ch.medianMs ? (k.medianMs / ch.medianMs).toFixed(2) + "×" : "–";
  const err = k.error ? "Kitesurf: " + k.error : ch.error ? "Chromium: " + ch.error : "";
  return "<tr><td>" + esc(c.site) + "</td><td>" + c.action + "</td><td class=k>" + fmt(k.medianMs) + "</td><td>" + fmt(ch.medianMs) + "</td><td>" + ratio +
    "</td><td>" + fmt(k.medianBrowserMs) + "</td><td>" + fmt(ch.medianBrowserMs) + "</td><td>" + k.failed + " / " + ch.failed + "</td><td class=err>" + esc(err) + "</td></tr>";
}
function foot() {
  const rows = [];
  for (const a of ["content", "markdown", "screenshot"]) {
    const cs = results.filter((c) => c.action === a);
    if (!cs.length) continue;
    const k = med(cs.map((c) => c.kitesurf.medianMs)), ch = med(cs.map((c) => c.chromium.medianMs));
    rows.push("<tr><td>All sites</td><td>" + a + "</td><td>" + fmt(k) + "</td><td>" + fmt(ch) + "</td><td>" + (k != null && ch ? (k / ch).toFixed(2) + "×" : "–") + "</td><td colspan=4></td></tr>");
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
  const text = JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 1);
  try { await navigator.clipboard.writeText(text); $("status").textContent = "Copied " + results.length + " rows as JSON."; }
  catch { $("status").textContent = "Copy was blocked; the JSON is in the console."; console.log(text); }
};
</script></body></html>`;
