// The story map (docs/story.html): every region on the road as a column, the four kinds of arc as rows, each beat a
// card, `needs` drawn as threads between them. Click a card to read it; served by `bun run story --serve`, a card the
// JSON holds can be edited and saved back to content/story.json (checked first). One self-contained page, no build.
import type { Report } from "../src/story/check.ts";
import { resolve } from "../src/story/check.ts";
import { regionOf, roadOrder } from "../src/story/infer.ts";
import { sectionLevel } from "../src/journey.ts";

export function storyPage(r: Report): string {
  const road = roadOrder().map(({ n }) => { const g = regionOf(n)!; return { n, id: g.id, name: g.name, level: sectionLevel(n, 0) }; });
  const beats = r.beats.map((b) => ({ ...b, where: resolve(b.at) ?? null }));
  const data = { road, arcs: r.arcs, beats, story: r.story, areas: r.story?.areas ?? [], card: r.card, score: r.score, problems: r.problems, clashes: r.clashes };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mythic Masters: the story map</title>
<style>
:root { --paper: #efe4c8; --paper-2: #e6d6b0; --ink: #2a2118; --faint: #6d5c45; --rust: #8c3b1f; --line: #b79f74;
  --main: #8c3b1f; --sub: #2f5a6b; --side: #4d6a2f; --unlock: #7a5a12; }
* { box-sizing: border-box; }
body { margin: 0; background: #3b2f22; color: var(--ink); font: 15px/1.45 Georgia, "Iowan Old Style", serif; }
header { padding: 18px 24px 10px; color: var(--paper); display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: baseline; }
header h1 { margin: 0; font-size: 26px; font-weight: normal; letter-spacing: .02em; }
header .card { font-size: 13px; opacity: .85; }
header .card b { color: #f0c27a; font-weight: normal; }
.legend { display: flex; gap: 14px; font-size: 13px; }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; background: var(--c); }
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.filters button { font: inherit; font-size: 12px; background: transparent; color: var(--paper); border: 1px solid #8a7656; border-radius: 12px; padding: 2px 10px; cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--paper); color: var(--ink); }
main { position: relative; margin: 0 16px 16px; background: var(--paper) radial-gradient(ellipse at 30% 20%, #f6eed8, transparent 60%); border-radius: 4px;
  box-shadow: inset 0 0 60px rgba(80,50,20,.35), 0 8px 30px rgba(0,0,0,.5); overflow-x: auto; }
.grid { display: grid; grid-template-columns: 92px repeat(var(--cols), minmax(190px, 1fr)); position: relative; min-width: calc(92px + var(--cols) * 190px); }
.head, .kind { position: sticky; top: 0; background: var(--paper-2); border-bottom: 1px solid var(--line); padding: 10px 10px 8px; z-index: 2; }
.head h2 { margin: 0; font-size: 15px; font-weight: normal; }
.head small, .kind small { color: var(--faint); font-size: 12px; display: block; }
.kind { position: static; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; border-right: 1px solid var(--line); color: var(--c); font-variant: small-caps; font-size: 17px; letter-spacing: .08em; }
.cell { border-left: 1px dashed rgba(120,90,50,.25); border-bottom: 1px solid rgba(120,90,50,.25); padding: 8px; display: flex; flex-direction: column; gap: 6px; z-index: 1; }
.beat { position: relative; text-align: left; font: inherit; font-size: 13px; line-height: 1.3; background: rgba(255,250,235,.8); color: var(--ink); border: 1px solid var(--line);
  border-left: 4px solid var(--c); border-radius: 3px; padding: 5px 7px 5px 8px; cursor: pointer; }
.beat:hover, .beat:focus-visible { background: #fffaf0; outline: 2px solid var(--c); }
.beat .t { display: block; }
.beat .m { display: block; color: var(--faint); font-size: 11px; }
.beat.game { background: rgba(240,230,205,.7); border-style: dashed; border-left-style: solid; }
.beat.idea .t::after { content: " (idea)"; color: var(--faint); font-size: 11px; }
.beat.owner { box-shadow: inset 0 0 0 1px var(--rust); }
.beat.dim { opacity: .2; }
.beat.lit { outline: 2px solid var(--c); background: #fffaf0; }
svg.threads { position: absolute; inset: 0; pointer-events: none; z-index: 1; overflow: visible; }
svg.threads path { fill: none; stroke: var(--rust); stroke-width: 1.2; opacity: .18; }
svg.threads path.lit { opacity: .9; stroke-width: 2; }
.area { padding: 8px 10px; font-size: 12.5px; color: var(--faint); border-left: 1px dashed rgba(120,90,50,.25); }
.area p { margin: 0 0 6px; color: var(--ink); font-style: italic; }
.area ul { margin: 0; padding-left: 16px; }
.area li.built { color: var(--ink); }
.area li.built::marker { content: "+ "; color: var(--side); }
aside { position: fixed; right: 16px; top: 16px; bottom: 16px; width: min(420px, calc(100vw - 32px)); background: var(--paper); border-radius: 4px; padding: 18px 20px;
  box-shadow: 0 10px 40px rgba(0,0,0,.6); overflow: auto; z-index: 10; display: none; }
aside.open { display: block; }
aside h3 { margin: 0 0 4px; font-weight: normal; font-size: 21px; }
aside .meta { color: var(--faint); font-size: 13px; margin-bottom: 10px; }
aside label { display: block; font-size: 12px; color: var(--faint); margin-top: 10px; }
aside input, aside textarea, aside select { width: 100%; font: inherit; font-size: 14px; background: #fffaf0; border: 1px solid var(--line); border-radius: 3px; padding: 6px 8px; color: var(--ink); }
aside textarea { min-height: 150px; resize: vertical; }
aside .row { display: flex; gap: 8px; margin-top: 14px; }
aside button.act { font: inherit; background: var(--ink); color: var(--paper); border: 0; border-radius: 3px; padding: 7px 14px; cursor: pointer; }
aside button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
aside .x { position: absolute; right: 12px; top: 10px; background: none; border: 0; font-size: 22px; cursor: pointer; color: var(--faint); }
aside .msg { margin-top: 10px; font-size: 13px; white-space: pre-wrap; }
aside .msg.bad { color: var(--rust); }
aside a { color: var(--sub); }
.problems { margin: 0 16px 10px; padding: 8px 12px; background: #f3d9c9; color: #6b2010; border-radius: 3px; font-size: 13px; }
</style></head>
<body>
<header>
  <h1>The story map</h1>
  <div class="card" id="card"></div>
  <div class="legend"><span style="--c:var(--main)">main</span><span style="--c:var(--sub)">sub</span><span style="--c:var(--side)">side</span><span style="--c:var(--unlock)">unlock</span><span style="color:#d8c8a8">dashed: the game plays it</span></div>
  <div class="filters" id="filters"></div>
</header>
<div id="problems"></div>
<main><div class="grid" id="grid"></div><svg class="threads" id="threads"></svg></main>
<aside id="panel" aria-live="polite"></aside>
<script>
const D = ${json};
const KINDS = ["main", "sub", "side", "unlock"];
const live = location.protocol.startsWith("http");
const $ = (s) => document.querySelector(s), esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const byId = new Map(D.beats.map((b) => [b.id, b]));
const col = (b) => { const i = D.road.findIndex((r) => r.n === b.where?.region); return i < 0 ? 0 : i; };
let arcFilter = null;

$("#card").innerHTML = "Story card <b>" + D.score + " / 5</b> · " + D.card.map((c) => c.id + " " + c.points.toFixed(2)).join(" · ");
if (D.problems.length || D.clashes.length) $("#problems").innerHTML = '<div class="problems">' + [...D.problems, ...D.clashes.map((c) => "game: " + c)].map(esc).join("<br>") + "</div>";
$("#filters").innerHTML = '<button aria-pressed="true" data-arc="">all threads</button>' + D.arcs.map((a) => '<button aria-pressed="false" data-arc="' + a.id + '">' + esc(a.title) + "</button>").join("");
$("#filters").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; arcFilter = b.dataset.arc || null;
  for (const x of $("#filters").children) x.setAttribute("aria-pressed", String(x === b)); paint(); };

function draw() {
  const g = $("#grid"); g.style.setProperty("--cols", D.road.length);
  let h = '<div class="head"></div>' + D.road.map((r, i) => '<div class="head"><h2>' + (i + 1) + ". " + esc(r.name) + "</h2><small>region " + r.n + " · from level " + r.level + "</small></div>").join("");
  for (const k of KINDS) {
    h += '<div class="kind" style="--c:var(--' + k + ')">' + k + "</div>";
    for (let i = 0; i < D.road.length; i++) {
      const here = D.beats.filter((b) => b.kind === k && col(b) === i).sort((a, b) => (a.where?.level ?? 0) - (b.where?.level ?? 0));
      h += '<div class="cell">' + here.map((b) => '<button class="beat ' + (b.game ? "game " : "") + b.status + (b.owner ? " owner" : "") + '" style="--c:var(--' + k + ')" data-id="' + b.id + '"><span class="t">' + esc(b.title) + '</span><span class="m">' + esc(b.where?.label ?? b.at) + (b.where?.level ? " · L" + b.where.level : "") + "</span></button>").join("") + "</div>";
    }
  }
  h += '<div class="kind" style="--c:var(--faint)">world</div>' + D.road.map((r) => { const a = D.areas.find((x) => x.region === r.id);
    return '<div class="area">' + (a ? "<p>" + esc(a.feel) + "</p><ul>" + a.world.map((w) => '<li class="' + w.status + '"><b>' + w.kind + "</b> " + esc(w.what) + "</li>").join("") + "</ul>" : "nothing written yet") + "</div>"; }).join("");
  g.innerHTML = h;
  threads();
}
function threads() {
  const svg = $("#threads"), box = $("main").getBoundingClientRect(), m = $("main");
  svg.setAttribute("width", m.scrollWidth); svg.setAttribute("height", m.scrollHeight);
  const at = (id) => { const el = document.querySelector('.beat[data-id="' + id + '"]'); if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.left - box.left + m.scrollLeft, y: r.top - box.top + m.scrollTop, w: r.width, h: r.height }; };
  let p = "";
  for (const b of D.beats) for (const n of b.needs ?? []) { const a = at(n), c = at(b.id); if (!a || !c) continue;
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = c.x + c.w / 2, y2 = c.y, my = (y1 + y2) / 2;
    p += '<path data-from="' + n + '" data-to="' + b.id + '" d="M' + x1 + "," + y1 + " C" + x1 + "," + my + " " + x2 + "," + my + " " + x2 + "," + y2 + '"/>'; }
  svg.innerHTML = p; paint();
}
function chain(id) { const s = new Set([id]); const up = (x) => { for (const n of byId.get(x)?.needs ?? []) if (!s.has(n)) { s.add(n); up(n); } };
  const down = (x) => { for (const b of D.beats) if ((b.needs ?? []).includes(x) && !s.has(b.id)) { s.add(b.id); down(b.id); } }; up(id); down(id); return s; }
let picked = null;
function paint() {
  const lit = picked ? chain(picked) : null;
  for (const el of document.querySelectorAll(".beat")) { const b = byId.get(el.dataset.id);
    el.classList.toggle("dim", (arcFilter && b.arc !== arcFilter) || (lit && !lit.has(b.id))); el.classList.toggle("lit", !!lit && lit.has(b.id)); }
  for (const p of document.querySelectorAll("#threads path")) p.classList.toggle("lit", !!lit && lit.has(p.dataset.from) && lit.has(p.dataset.to));
}
function findJson(id) { for (const a of D.story?.arcs ?? []) { const b = a.beats.find((x) => x.id === id); if (b) return b; } return null; }
function open(id) {
  picked = id; paint(); const b = byId.get(id), j = findJson(id), arc = D.arcs.find((a) => a.id === b.arc), p = $("#panel");
  const needs = (b.needs ?? []).map((n) => '<a href="#" data-go="' + n + '">' + esc(byId.get(n)?.title ?? n) + "</a>").join(", ") || "nothing";
  let h = '<button class="x" aria-label="Close">×</button><h3>' + esc(b.title) + '</h3><div class="meta">' + esc(b.kind) + " · " + esc(arc?.title ?? b.arc) + " · " + esc(b.where?.label ?? b.at) + (b.where?.level ? " · level " + b.where.level : "") + " · " + b.status + (b.owner ? " · the owner writes this" : "") + "</div>";
  if (j && live) {
    h += '<label>Title<input id="f-title" value="' + esc(j.title) + '"></label><label>What happens<textarea id="f-text">' + esc(j.text) + "</textarea></label>" +
      '<label>Where (' + esc(b.at) + ')<input id="f-at" value="' + esc(j.at) + '"></label><label>Needs (beat ids, commas)<input id="f-needs" value="' + esc((j.needs ?? []).join(", ")) + '"></label>' +
      '<label>Opens<input id="f-opens" value="' + esc(j.opens ?? "") + '"></label><label>Status<select id="f-status">' + ["idea", "approved", "built"].map((s) => "<option" + (s === j.status ? " selected" : "") + ">" + s + "</option>").join("") + "</select></label>" +
      '<div class="row"><button class="act" id="save">Save to content/story.json</button><button class="act ghost" id="cancel">Close</button></div><div class="msg" id="msg"></div>';
  } else {
    h += "<p>" + esc(b.text) + "</p>" + (b.opens ? "<p><b>Opens:</b> " + esc(b.opens) + "</p>" : "");
    h += '<p class="meta">' + (b.game ? "The game plays this; it is read from the game's own files, so edit it there." : live ? "" : "Run <code>bun run story --serve</code> in apps/mythic-masters to edit here, or edit content/story.json (also in <code>bun run cms</code>).") + "</p>";
  }
  h += '<p class="meta">Needs: ' + needs + "</p>";
  p.innerHTML = h; p.classList.add("open");
  p.querySelector(".x").onclick = close; const c = p.querySelector("#cancel"); if (c) c.onclick = close;
  for (const a of p.querySelectorAll("[data-go]")) a.onclick = (e) => { e.preventDefault(); open(a.dataset.go); };
  const s = p.querySelector("#save"); if (s) s.onclick = () => save(j);
}
function close() { picked = null; $("#panel").classList.remove("open"); paint(); }
async function save(j) {
  const v = (id) => document.getElementById(id).value.trim();
  j.title = v("f-title"); j.text = v("f-text"); j.at = v("f-at"); j.status = v("f-status");
  const needs = v("f-needs").split(",").map((s) => s.trim()).filter(Boolean); if (needs.length) j.needs = needs; else delete j.needs;
  const opens = v("f-opens"); if (opens) j.opens = opens; else delete j.opens;
  const res = await fetch("/save", { method: "POST", body: JSON.stringify(D.story, null, 2) }), out = await res.json(), msg = $("#msg");
  if (out.ok) { msg.className = "msg"; msg.textContent = "Saved. Reloading."; setTimeout(() => location.reload(), 400); }
  else { msg.className = "msg bad"; msg.textContent = "Not saved:\\n" + out.problems.join("\\n"); }
}
$("#grid").addEventListener("click", (e) => { const b = e.target.closest(".beat"); if (b) open(b.dataset.id); });
addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
addEventListener("resize", threads);
draw();
</script></body></html>
`;
}
