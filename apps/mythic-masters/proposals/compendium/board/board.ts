// The source-art board: regions in layers out from the Pine Barrens, each a full-width band of cryptid folders with
// its boss across the bottom; a folder opens its reference pictures full size with their credits.
// Run from apps/mythic-masters: bun <this> <layers.json> <out.html>
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

type B = { id: string; name: string; starter: boolean; rebuilt: boolean };
type G = { n: number; name: string; tier: string; layer: number; next: number[]; boss: string | null; beasts: B[] };
type Img = { file: string; from?: string; page?: string; artist?: string; license?: string };
const [src, out] = process.argv.slice(2) as [string, string];
const regions: G[] = await Bun.file(src).json();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function jpeg(file: string, w: number, q: number): Promise<string> {
  const o = join(tmpdir(), `bd-${Math.random().toString(36).slice(2)}.jpg`);
  await $`ffmpeg -loglevel error -y -i ${file} -vf ${`scale='min(${w},iw)':-2`} -q:v ${q} ${o}`.quiet();
  const b = Buffer.from(await Bun.file(o).arrayBuffer()).toString("base64");
  rmSync(o, { force: true });
  return `data:image/jpeg;base64,${b}`;
}
type Pic = { thumb: string; full: string; credit: string; page: string; file?: string };
type Art = { pics: Pic[]; owner: number; fetched: boolean; model?: Pic };
const cache = new Map<string, Art>();
const MODELS = join(import.meta.dir, "models");
async function model(id: string): Promise<Pic | undefined> {
  const tq = join(MODELS, `${id}.three-quarter.png`), strip = join(MODELS, `${id}.png`);
  if (!existsSync(tq) || !existsSync(strip)) return undefined;
  return { thumb: await jpeg(tq, 260, 5), full: await jpeg(strip, 1400, 5), credit: "Our model, as the game has it now: front, side, three-quarter, head", page: "" };
}
async function art(id: string): Promise<Art> {
  if (cache.has(id)) return cache.get(id)!;
  const json = `refs/${id}.json`, dir = `refs/${id}`;
  let a: Art = { pics: [], owner: 0, fetched: false, model: await model(id) };
  if (existsSync(json)) {
    const meta: { images: Img[] } = await Bun.file(json).json();
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort() : [];
    const isOwner = (f: string) => !/^(c\d+|card-(bw|color))\.jpg$/.test(f);
    const order = [...files.filter(isOwner), ...files.filter((f) => !isOwner(f))];
    const pics = await Promise.all(order.map(async (f) => {
      const m = meta.images.find((i) => i.file === f);
      const credit = isOwner(f) ? "Your picture" : m ? `${m.artist ?? "Unknown"} · ${m.license ?? ""}` : "";
      return { thumb: await jpeg(join(dir, f), 220, 6), full: await jpeg(join(dir, f), 760, 5), credit, page: m?.page ?? "", file: f };
    }));
    a = { ...a, pics, owner: files.filter(isOwner).length, fetched: true };
  }
  cache.set(id, a);
  return a;
}

const STARTERS = ["hodag", "squonk", "agropelter", "jackalope", "tatzelwurm"];
const NOTES: Record<string, string> = {
  "flatwoods-monster": "Redesign from your picture: teardrop cowl, small red eyes, insect arms, skirt fading into green mist. First prototype built; its rig still finds a stray foot.",
};
const status = (a: Art) =>
  a.owner ? ["good", "your picture"] : !a.fetched ? ["none", "not fetched yet"] : a.pics.length >= 3 ? ["ok", `${a.pics.length} pictures`] : ["thin", `only ${a.pics.length}`];

type GPic = { src: string; credit: string; page: string; file?: string; model?: true };
const gallery: Record<string, { name: string; pics: GPic[]; note?: string }> = {};
const chips = (b: B) => STARTERS.includes(b.id) ? `<span class="chip st">starter</span>` : "";
const made = (b: B) => b.rebuilt ? `<span class="made yes">remade</span>` : `<span class="made no">not remade yet</span>`;
function remember(b: B, a: Art) {
  const pics: GPic[] = [...(a.model ? [{ src: a.model.full, credit: a.model.credit, page: "", model: true as const }] : []), ...a.pics.map((p) => ({ src: p.full, credit: p.credit, page: p.page, file: p.file }))];
  gallery[b.id] = { name: b.name, pics, ...(NOTES[b.id] ? { note: NOTES[b.id] } : {}) };
  return pics.length;
}
const refImg = (b: B, p: Pic) => `<img src="${p.thumb}" alt="" data-ref="${b.id}~${p.file}">`;

async function folder(b: B): Promise<string> {
  const a = await art(b.id), [cls, label] = status(a), n = remember(b, a);
  const peek = a.pics.slice(0, 2);
  return `<button class="folder" type="button" data-id="${b.id}" ${n ? "" : "disabled"} aria-label="Open ${esc(b.name)}: our model, then its pictures">
  <span class="tab"></span>
  <span class="body">
    <span class="peek">${peek.map((p) => refImg(b, p)).join("")}${a.model ? `<img class="model" src="${a.model.thumb}" alt="Our ${esc(b.name)} model">` : ""}${n ? "" : `<span class="none-yet">no pictures yet</span>`}</span>
    ${made(b)}
  </span>
  <span class="label"><span class="nm">${esc(b.name)}</span><span class="art ${cls}" data-status="${b.id}"><span class="dot"></span>${label}</span></span>
  <span class="chips">${chips(b)}</span>
</button>`;
}

async function boss(b: B): Promise<string> {
  const a = await art(b.id), [cls, label] = status(a), n = remember(b, a);
  return `<button class="boss" type="button" data-id="${b.id}" ${n ? "" : "disabled"} aria-label="Open ${esc(b.name)}: our model, then its pictures">
  <span class="bosshead"><span class="eyebrow">Boss · the mythic at the region's arena</span><span class="nm">${esc(b.name)}</span>${made(b)}<span class="art ${cls}" data-status="${b.id}"><span class="dot"></span>${label}</span><span class="chips">${chips(b)}</span></span>
  <span class="strip">${a.model ? `<span class="modelcell"><img src="${a.model.thumb}" alt="Our ${esc(b.name)} model"><span>our model</span></span>` : ""}${a.pics.map((p) => refImg(b, p)).join("") || `<span class="none-yet">no pictures yet</span>`}</span>
</button>`;
}

const byN = new Map(regions.map((g) => [g.n, g]));
const all = regions.flatMap((g) => g.beasts);
const LAYER = ["Start", "Layer one", "Layer two", "Layer three", "Layer four", "Layer five", "Layer six"];
const WINS = ["open from the first step", "one arena win away", "two wins away", "three wins away", "four wins away", "five wins away", "six wins away"];
const sections: string[] = [];
for (const L of [...new Set(regions.map((g) => g.layer))].sort((a, b) => a - b)) {
  const bands: string[] = [];
  for (const g of regions.filter((x) => x.layer === L)) {
    const opens = g.next.filter((n) => byN.get(n)!.layer > L).map((n) => byN.get(n)!.name);
    const from = g.next.filter((n) => byN.get(n)!.layer < L).map((n) => byN.get(n)!.name);
    const bossB = g.beasts.find((b) => b.id === g.boss);
    const rest = g.beasts.filter((b) => b !== bossB);
    bands.push(`<section class="region ${g.tier}" id="r${g.n}">
  <header><span class="num">${g.n}</span><h3>${esc(g.name)}</h3>${g.tier === "high-level" ? `<span class="chip hi">high level</span>` : ""}
    <span class="routes">${from.length ? `<span>from ${from.map(esc).join(", ")}</span>` : ""}${opens.length ? `<span>opens <b>${opens.map(esc).join("</b>, <b>")}</b></span>` : ""}</span></header>
  ${rest.length ? `<div class="folders">${(await Promise.all(rest.map(folder))).join("")}</div>` : ""}
  ${bossB ? await boss(bossB) : rest.length ? "" : `<p class="empty-region">No cryptids live here yet.</p>`}
</section>`);
  }
  sections.push(`<div class="layer"><h2>${LAYER[L] ?? `Layer ${L}`}<small>${WINS[L] ?? ""}</small></h2>${bands.join("")}</div>`);
}
const starterRows: B[] = STARTERS.map((id) => all.find((b) => b.id === id) ?? { id, name: id[0]!.toUpperCase() + id.slice(1), starter: true, rebuilt: true });
const starters = (await Promise.all(starterRows.map(folder))).join("");
const fetched = all.filter((b) => cache.get(b.id)?.fetched).length;

const html = `<title>Cryptid Source Art</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
/* Layout: one full-width band per region, layer by layer out from the Pine Barrens; folders in a grid, the boss across the bottom */
:root{--bg:#eef0ea;--panel:#f8f9f5;--folder:#e3d3ab;--folder-tab:#d4bf8c;--ink:#1f2620;--mute:#606a61;--line:#d3d8cd;--accent:#b5761c;--moss:#3f6b46;--warn:#a3561f;--hi:#7a3d58;--scrim:rgba(14,18,15,.82);
--display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--body:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141815;--panel:#1c211d;--folder:#4a4130;--folder-tab:#5b5039;--ink:#e6eae2;--mute:#9aa497;--line:#313830;--accent:#e2a34a;--moss:#7fb486;--warn:#e08a52;--hi:#d48bab;--scrim:rgba(5,7,6,.88);color-scheme:dark}}
:root[data-theme=dark]{--bg:#141815;--panel:#1c211d;--folder:#4a4130;--folder-tab:#5b5039;--ink:#e6eae2;--mute:#9aa497;--line:#313830;--accent:#e2a34a;--moss:#7fb486;--warn:#e08a52;--hi:#d48bab;--scrim:rgba(5,7,6,.88);color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--body);padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wrap{max-width:1180px;margin:0 auto;display:grid;gap:28px}
.top{display:grid;gap:10px}
h1{font:700 clamp(30px,5vw,46px)/1.05 var(--display);margin:0;text-wrap:balance}
.lede{margin:0;max-width:68ch;color:var(--mute)}
.steps{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 0;padding:0;list-style:none}
.steps li{font:500 13px var(--body);border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:4px 12px}
.steps li b{font-family:var(--mono);color:var(--accent);margin-right:6px}.steps li.now{border-color:var(--accent)}
.key{display:flex;flex-wrap:wrap;gap:16px}
.layer{display:grid;gap:14px}
h2{font:700 24px var(--display);margin:0;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:6px}
h2 small{font:500 12px var(--mono);color:var(--mute);letter-spacing:.05em;text-transform:uppercase}
.region{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:14px}
.region.high-level{border-style:dashed}
.region>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.num{font:500 13px var(--mono);color:var(--accent)}
h3{font:700 19px var(--display);margin:0}
.routes{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--mute);margin-left:auto}.routes b{color:var(--ink);font-weight:600}
.folders{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.starters .folders{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;cursor:pointer}
button:disabled{cursor:default}
button:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:10px}
.folder{display:grid;gap:6px;position:relative}
.folder .tab{width:42%;height:12px;background:var(--folder-tab);border-radius:8px 8px 0 0;margin-bottom:-1px}
.folder .body{background:var(--folder);border-radius:0 10px 10px 10px;aspect-ratio:4/3;padding:10px;display:grid;place-items:center;overflow:hidden;transition:transform .15s}
.folder:not(:disabled):hover .body{transform:translateY(-2px)}
.peek{position:relative;width:100%;height:100%;display:block}
.peek img{position:absolute;width:52%;aspect-ratio:1;object-fit:cover;border-radius:5px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);border:3px solid #fff}
.peek img[data-ref]:nth-child(1){left:0;top:4%;transform:rotate(-8deg)}.peek img[data-ref]:nth-child(2){right:0;top:2%;transform:rotate(7deg)}
.peek img.model{left:19%;top:12%;width:62%;z-index:2;background:#3d3d3d;border-color:var(--panel)}
img.gone{opacity:.25;filter:grayscale(1)}
.folder .body{position:relative}
.made{font:600 11px var(--mono);border-radius:999px;padding:2px 8px;white-space:nowrap}
.folder .made{position:absolute;right:8px;bottom:8px;z-index:3}
.made.yes{background:var(--moss);color:var(--panel)}.made.no{background:var(--warn);color:var(--panel)}
.modelcell{position:relative;display:block}.modelcell img{background:#3d3d3d}
.modelcell span{position:absolute;left:6px;bottom:6px;font:600 11px var(--mono);background:var(--panel);border-radius:999px;padding:1px 8px}
.qmark{position:absolute;left:8px;top:8px;z-index:3;font:600 11px var(--mono);background:var(--accent);color:var(--panel);border-radius:999px;padding:2px 8px}
.train{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);padding-block:10px;border-bottom:1px solid var(--line);display:grid;gap:8px}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--bg)}
.train h2{border:0;padding:0;font-size:18px}
.cars{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.car{flex:none;width:230px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:grid;gap:4px;font-size:13px}
.car b{font:600 14px var(--body)}.car p{margin:0;color:var(--mute);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.car .st{font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.05em}
.car.queued .st{color:var(--accent)}.car.working .st{color:var(--hi)}.car.done .st{color:var(--moss)}.car.done{opacity:.7}
.car .pos{font:500 11px var(--mono);color:var(--mute)}
.trainmsg{margin:0;font-size:13px;color:var(--mute)}
.vside{display:grid;gap:8px;background:rgba(255,255,255,.08);border-radius:10px;padding:10px;color:#eef0ea}
.vrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.vbtn{font:600 13px var(--body);border-radius:999px;padding:7px 14px;background:rgba(255,255,255,.16);color:#fff}
.vbtn.primary{background:#e2a34a;color:#1c211d}
.vbtn.drop[aria-pressed=true]{background:#e08a52;color:#1c211d}
.vbtn:disabled{opacity:.45}
.vside textarea{width:100%;min-height:72px;resize:vertical;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.25);color:#fff;font:14px/1.45 var(--body);padding:8px}
.vside label{font:600 12px var(--mono);letter-spacing:.04em;text-transform:uppercase;opacity:.8}
.vmsg{font-size:13px;color:#f2c27a;min-height:1.2em}
.vstage img.gone{opacity:.35}
.none-yet{font-size:12px;color:var(--mute)}
.label{display:grid;gap:2px}.nm{font:600 15px var(--body)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font:500 11px var(--mono);border-radius:999px;padding:1px 8px;white-space:nowrap;border:1px solid currentColor}
.chip.done{color:var(--moss)}.chip.hi{color:var(--hi)}.chip.st{color:var(--accent)}
.art{font:500 12px var(--mono);display:flex;align-items:center;gap:6px;margin:0}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
.art.good{color:var(--moss)}.art.ok{color:var(--ink)}.art.thin{color:var(--warn)}.art.none{color:var(--mute)}
.boss{display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px;width:100%}
.bosshead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.eyebrow{font:500 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);width:100%}
.boss .nm{font:700 22px var(--display)}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(120px,1fr);gap:8px;overflow-x:auto}
.strip img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;background:#fff;display:block}
.boss:not(:disabled):hover .strip img{filter:brightness(1.05)}
.empty-region{margin:0;font-size:13px;color:var(--mute)}
dialog{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;color:var(--ink)}
dialog::backdrop{background:var(--scrim)}
.viewer{height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:12px;padding-block:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-bottom,0px));padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.vhead{display:flex;align-items:center;gap:12px;color:#f2f4ef}
.vhead h4{font:700 22px var(--display);margin:0}.vhead .count{font:500 13px var(--mono);opacity:.7}
.vclose{margin-left:auto;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center;color:#fff}
.vclose svg,.vnav svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.vstage{position:relative;display:grid;place-items:center;min-height:0}
.vstage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;background:#fff}
.vnav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;display:grid;place-items:center}
.vnav.prev{left:0}.vnav.next{right:0}
.vfoot{display:grid;gap:8px;color:#e7eae3;font-size:13px}
.vfoot a{color:#f2c27a}
.vnote{background:rgba(226,163,74,.18);border-radius:8px;padding:8px 10px;max-width:70ch}
.thumbs{display:flex;gap:6px;overflow-x:auto}
.thumbs button{flex:none;width:56px;height:56px;border-radius:6px;overflow:hidden;opacity:.55;border:2px solid transparent}
.thumbs button[aria-current=true]{opacity:1;border-color:#f2c27a}
.thumbs img{width:100%;height:100%;object-fit:cover;display:block;background:#fff}
@media (max-width:560px){.routes{margin-left:0}.folders{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){.folder .body{transition:none}}
</style>
<div class="wrap">
<div class="top">
  <h1>Cryptid Source Art</h1>
  <p class="lede">Every cryptid's reference pictures, the way a player meets them. The Pine Barrens is open from the start, and beating a region's arena opens the regions it borders. Each layer is one more win out. Open a folder to see its pictures full size. Once the source art is right, each model is remade from it.</p>
  <ol class="steps"><li class="now"><b>1</b>Source art</li><li><b>2</b>You confirm the direction</li><li><b>3</b>One prototype at a time</li><li><b>4</b>Hill-climb it</li></ol>
  <div class="key"><p class="art good"><span class="dot"></span>your picture</p><p class="art ok"><span class="dot"></span>3 or more pictures</p><p class="art thin"><span class="dot"></span>too few</p><p class="art none"><span class="dot"></span>not fetched yet</p></div>
  <p class="lede">Pictures are in for ${fetched} of the ${all.length} cryptids on the map: the Bog Witch's starters and layers one and two. Layer three onward comes next. Each folder opens on our model as the game has it now, then the pictures. Drop the bad ones, write what you want done, and queue it: Claude works the queue in order and marks each one done.</p>
</div>
<section class="train" aria-live="polite"><h2>The queue<small id="qcount"></small></h2><div class="cars" id="cars"></div><p class="trainmsg" id="trainmsg">Loading the queue…</p></section>
<section class="region starters"><header><h3>The Bog Witch's starters</h3><span class="routes"><span>you take three of the five</span></span></header><div class="folders">${starters}</div></section>
${sections.join("\n")}
</div>
<dialog id="viewer" aria-label="Reference pictures">
  <div class="viewer">
    <div class="vhead"><h4 id="vname"></h4><span class="count" id="vcount"></span>
      <button class="vclose" type="button" id="vclose" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="vstage">
      <img id="vimg" alt="">
      <button class="vnav prev" type="button" id="vprev" aria-label="Previous picture"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
      <button class="vnav next" type="button" id="vnext" aria-label="Next picture"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="vfoot"><div class="vrow"><span id="vcredit"></span><button class="vbtn drop" type="button" id="vdrop" aria-pressed="false" hidden>Drop this picture</button></div>
      <div class="vnote" id="vnote" hidden></div><div class="thumbs" id="vthumbs"></div>
      <div class="vside"><label for="vorder" id="vorderlabel">What to do for this one</label>
        <textarea id="vorder" placeholder="e.g. find a photo of the town statue; prototype from picture 3; make the eyes smaller"></textarea>
        <div class="vrow"><button class="vbtn primary" type="button" id="vqueue">Queue it</button><span class="vmsg" id="vmsg"></span></div></div></div>
  </div>
</dialog>
<script type="application/json" id="gallery">${JSON.stringify(gallery).replace(/</g, "\\u003c")}</script>
<script>
const G = JSON.parse(document.getElementById("gallery").textContent);
const dlg = document.getElementById("viewer"), $ = (id) => document.getElementById(id);
let cur = null, at = 0, db = null;
const drops = new Set(), cars = [];  // drops: "beast~file"; cars: queue docs, oldest first
const key = (id, p) => id + "~" + p.file;
function paintDrops() {
  document.querySelectorAll("img[data-ref]").forEach((im) => im.classList.toggle("gone", drops.has(im.dataset.ref)));
  if (dlg.open) show(at);
}
function show(i) {
  const pics = G[cur].pics; at = (i + pics.length) % pics.length; const p = pics[at];
  const gone = !!p.file && drops.has(key(cur, p));
  $("vimg").src = p.src; $("vimg").classList.toggle("gone", gone); $("vcount").textContent = (at + 1) + " of " + pics.length;
  $("vcredit").textContent = "";
  $("vcredit").append(document.createTextNode(gone ? "Dropped · " + p.credit : p.credit));
  if (p.page) { const a = document.createElement("a"); a.href = p.page; a.target = "_blank"; a.rel = "noopener"; a.textContent = "source"; $("vcredit").append(" · ", a); }
  $("vdrop").hidden = !p.file || !db; $("vdrop").setAttribute("aria-pressed", String(gone)); $("vdrop").textContent = gone ? "Keep it after all" : "Drop this picture";
  [...$("vthumbs").children].forEach((b, k) => { b.setAttribute("aria-current", String(k === at)); b.firstChild.classList.toggle("gone", !!pics[k].file && drops.has(key(cur, pics[k]))); });
  $("vprev").hidden = $("vnext").hidden = pics.length < 2;
}
const openCar = (id) => cars.find((c) => c.beast === id && c.status === "queued");
function open(id) {
  cur = id; const g = G[id]; $("vname").textContent = g.name;
  $("vnote").hidden = !g.note; $("vnote").textContent = g.note || "";
  $("vthumbs").replaceChildren(...g.pics.map((p, k) => { const b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", p.model ? "Our model" : "Picture " + k); const im = document.createElement("img"); im.src = p.src; im.alt = ""; b.append(im); b.onclick = () => show(k); return b; }));
  $("vorderlabel").textContent = "What to do for the " + g.name;
  const c = openCar(id); $("vorder").value = c ? c.order : ""; $("vqueue").textContent = c ? "Update its place in the queue" : "Queue it";
  $("vqueue").disabled = !db; $("vmsg").textContent = db ? "" : "The queue isn't reachable from this view; the pictures still are.";
  show(0); dlg.showModal();
}
async function toggleDrop() {
  const p = G[cur].pics[at]; if (!p.file || !db) return;
  const k = key(cur, p), ref = db.collection("drops").doc(k.replace(/[^A-Za-z0-9_.~:@+-]/g, "_"));
  $("vdrop").disabled = true;
  try { if (drops.has(k)) await ref.delete(); else await ref.set({ beast: cur, file: p.file, at: new Date().toISOString() }); }
  catch (e) { $("vmsg").textContent = "Couldn't save that: " + (e && e.message || "try again"); }
  $("vdrop").disabled = false;
}
async function queueIt() {
  const order = $("vorder").value.trim(), mine = [...drops].filter((k) => k.startsWith(cur + "~")).map((k) => k.slice(cur.length + 1));
  if (!order && !mine.length) { $("vmsg").textContent = "Write what to do, or drop a picture, first."; return; }
  $("vqueue").disabled = true;
  try {
    const c = openCar(cur), body = { beast: cur, name: G[cur].name, order, drops: mine, status: "queued", at: c ? c.at : new Date().toISOString(), note: "" };
    if (c) await db.collection("queue").doc(c.id).set(body); else await db.collection("queue").add(body);
    $("vmsg").textContent = c ? "Updated." : "Queued.";
    $("vqueue").textContent = "Update its place in the queue";
  } catch (e) { $("vmsg").textContent = "Couldn't queue it: " + (e && e.message || "try again"); }
  $("vqueue").disabled = false;
}
function paintTrain() {
  const live = cars.filter((c) => c.status !== "done"), done = cars.filter((c) => c.status === "done").slice(-4);
  $("qcount").textContent = live.length ? live.length + " waiting or in the works" : "";
  $("trainmsg").textContent = cars.length ? "" : "Nothing queued yet. Open a folder, say what you want, and queue it.";
  $("cars").replaceChildren(...[...live, ...done].map((c, i) => {
    const el = document.createElement("button"); el.type = "button"; el.className = "car " + c.status;
    const st = document.createElement("span"); st.className = "st"; st.textContent = c.status === "working" ? "Claude is on it" : c.status;
    const b = document.createElement("b"); b.textContent = c.name;
    const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = c.status === "done" ? (c.note || "done") : "#" + (i + 1) + (c.drops && c.drops.length ? " · " + c.drops.length + " dropped" : "");
    const p = document.createElement("p"); p.textContent = c.order || "Swap out the dropped pictures";
    el.append(st, b, p, pos); el.onclick = () => G[c.beast] && open(c.beast); return el;
  }));
  document.querySelectorAll(".qmark").forEach((m) => m.remove());
  live.forEach((c, i) => document.querySelectorAll('[data-id="' + c.beast + '"] .body, [data-id="' + c.beast + '"] .bosshead').forEach((el) => {
    const m = document.createElement("span"); m.className = "qmark"; m.textContent = c.status === "working" ? "in the works" : "queued #" + (i + 1); el.prepend(m);
  }));
}
$("vdrop").onclick = toggleDrop; $("vqueue").onclick = queueIt;
(async () => {
  const timer = setTimeout(() => { if (!cars.length) $("trainmsg").textContent = "The queue can't be reached yet; the pictures still work."; }, 10000);
  try { db = window.claude && await window.claude.use("db"); } catch { db = null; }
  if (!db) { clearTimeout(timer); $("trainmsg").textContent = "The queue works on the published page in claude.ai; here you can still look through the pictures."; return; }
  db.collection("drops").onSnapshot((s) => { drops.clear(); s.docs.forEach((d) => { const x = d.data(); drops.add(x.beast + "~" + x.file); }); paintDrops(); }, () => {});
  db.collection("queue").orderBy("at").onSnapshot((s) => { clearTimeout(timer); cars.length = 0; s.docs.forEach((d) => cars.push({ id: d.id, ...d.data() })); paintTrain(); },
    () => { clearTimeout(timer); $("trainmsg").textContent = "The queue stopped answering; reload to see it again."; });
})();
document.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => G[b.dataset.id]?.pics.length && open(b.dataset.id)));
$("vclose").onclick = () => dlg.close(); $("vprev").onclick = () => show(at - 1); $("vnext").onclick = () => show(at + 1);
dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.classList.contains("vstage")) dlg.close(); });
document.addEventListener("keydown", (e) => { if (!dlg.open) return; if (e.key === "ArrowLeft") show(at - 1); if (e.key === "ArrowRight") show(at + 1); });
</script>
`;
await Bun.write(out, html);
console.log(out, (html.length / 1024 / 1024).toFixed(1) + " MB");
