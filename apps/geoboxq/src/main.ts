// The page: two lists (boxes, products), one answer. Everything is computed here, in the browser, and kept in
// localStorage; nothing about your boxes leaves the machine.
import { accountChip, finishSignIn, reportButton } from "./account.ts";
import { learn, suggest, type Memory } from "./baxter.ts";
import { solve, type Solution } from "./engine.ts";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { blank, example, group, innerOf, parseRows, toInput, usableBoxes, verdict, wallOf, type Group, type Row, type State } from "./model.ts";
import { parts, sceneSvg, shapeSvg, THEMES } from "./viz.ts";

// Lucide icons (24-unit grid, stroke), inline so the page loads no icon font.
const icon = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  package: icon('<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zM12 22V12M3.3 7 12 12l8.7-5"/>'),
  plus: icon('<path d="M5 12h14M12 5v14"/>'),
  trash: icon('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  upload: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  play: icon('<path d="m6 3 14 9-14 9z"/>'),
  pause: icon('<path d="M14 4h4v16h-4zM6 4h4v16H6z"/>'),
  repeat: icon('<path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>'),
  sparkles: icon('<path d="M9.94 14.06 9 17l-.94-2.94L5 13l3.06-.94L9 9l.94 3.06L13 13zM19 3v4M21 5h-4M19 17v4M21 19h-4"/>'),
};

const KEY = "geoboxq:v2";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (n: number) => String(Math.round(n * 100) / 100);

function load(): State {
  try { const s = localStorage.getItem(KEY); if (s) return { ...example(), ...JSON.parse(s) } as State; } catch { /* private window: start fresh */ }
  return example();
}
let state = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept */ } };

// Baxter the Boxer is off until ticked; what he learned stays in this browser, under its own key.
const BAXTER = "geoboxq:baxter";
function loadBaxter(): Memory {
  try { const m = JSON.parse(localStorage.getItem(BAXTER) ?? "null"); if (m && Array.isArray(m.seen)) return { on: !!m.on, seen: m.seen }; } catch { /* start fresh */ }
  return { on: false, seen: [] };
}
let baxter = loadBaxter();
const saveBaxter = () => { try { localStorage.setItem(BAXTER, JSON.stringify(baxter)); } catch { /* not kept */ } };

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="account" id="account"></div>
  <h1>${ICON.package} GeoBoxQ</h1>
  <p class="lede">Will it fit in the box? Including a box in a box in a box.</p>
  <section id="boxes"></section>
  <section id="items"></section>
  <section class="options" id="options"></section>
  <section id="baxter"></section>
  <section id="answer" aria-live="polite"></section>`;
const $ = (id: string) => document.getElementById(id)!;
accountChip($("account"));
reportButton();
void finishSignIn().then((back) => { if (back) accountChip($("account"), { note: back.error }); }); // back from eqosys with ?code=&state=

const field = (r: Row, k: "l" | "w" | "h", label: string) =>
  `<input type="number" min="0" step="any" inputmode="decimal" data-k="${k}" value="${r[k] || ""}" aria-label="${label}" placeholder="${label[0]}">`;

const theme = () => THEMES[state.theme] ?? THEMES[0]!;
const dims = (r: Row) => [r.l, r.w, r.h] as [number, number, number];
const thumbOf = (r: Row, items: boolean) => shapeSvg(dims(r), items && r.holds ? innerOf(r, state.unit) : null, theme(), items ? theme().pieces[0] : theme().shell);

function list(id: "boxes" | "items") {
  const items = id === "items";
  const rows = state[id];
  $(id).innerHTML = `
    <h2>${items ? "Products" : "Shipping boxes"}</h2>
    <p class="hint">${items ? "Outside size. Tick the checkbox on anything that opens and can carry other things." : "Inside size, what actually fits."} In ${state.unit}. Any number works: type one and watch it become a line, a square, a box.</p>
    ${rows.map((r, i) => `
      <div class="entry" data-i="${i}">
        <div class="row ${items ? "item" : ""}">
          <div class="thumb">${thumbOf(r, items)}</div>
          <input class="name" data-k="name" value="${esc(r.name)}" placeholder="Name" aria-label="Name">
          ${field(r, "l", "Length")}${field(r, "w", "Width")}${field(r, "h", "Height")}
          ${items ? `<input type="number" min="1" step="1" data-k="qty" value="${r.qty}" aria-label="How many">
            <label title="Opens and can hold other products"><input type="checkbox" data-k="holds" ${r.holds ? "checked" : ""} aria-label="Opens and can hold other products"></label>` : ""}
          <button class="icon" data-act="del" title="Remove" aria-label="Remove">${ICON.trash}</button>
        </div>
        ${items && r.holds ? `<div class="row inside">
          <span class="dim">Room inside</span>
          ${innerOf(r, state.unit).map((v, k) => `<input type="number" min="0" step="any" inputmode="decimal" data-k="in${k}" value="${v}" aria-label="Inside ${["length", "width", "height"][k]}">`).join("")}
          <span class="dim">${r.inner ? "yours" : `${wallOf(state.unit)} ${state.unit} walls assumed`}</span>
        </div>` : ""}
      </div>`).join("")}
    <div class="tools">
      <button data-act="add">${ICON.plus} Add</button>
      <button data-act="import-toggle">${ICON.upload} Import</button>
      <input type="file" accept=".csv,.tsv,.txt" hidden data-act="file">
    </div>
    <div data-slot="import" hidden>
      <textarea placeholder="${items ? "Gift tin, 7, 5, 4, 1\nCandle, 3, 3, 3.5, 2" : "Small, 8, 6, 4\nMedium, 12x9x6"}" aria-label="Paste rows"></textarea>
      <p class="hint">Paste rows, a Shopify product export or a carrier box chart, or drop a CSV: name, length, width, height${items ? ", quantity" : ""}. A header line works, and so does 10x8x4 in one cell.</p>
      <button data-act="import">${ICON.check} Add these</button>
    </div>`;
}

function options() {
  $("options").innerHTML = `
    <label>Unit <select data-k="unit"><option ${state.unit === "in" ? "selected" : ""}>in</option><option ${state.unit === "cm" ? "selected" : ""}>cm</option></select></label>
    <label>Padding <input type="number" min="0" step="any" data-k="pad" value="${state.pad}"></label>
    <label><input type="checkbox" data-k="nest" ${state.nest ? "checked" : ""}> Box in a box</label>
    <label title="Baxter the Boxer learns the shapes you pack and suggests box sizes. Kept in this browser only."><input type="checkbox" data-k="baxter" ${baxter.on ? "checked" : ""}> Baxter</label>
    <button data-act="example">${ICON.sparkles} Example</button>`;
}

function tree(gs: Group[], top = false): string {
  if (!gs.length) return "";
  return `<ul${top ? ' class="tree"' : ""}>${gs.map((g) => `<li>${esc(g.name)}${g.count > 1 ? ` &times; ${g.count}` : ""} <span class="dim">${g.size.map(num).join(" &times; ")}</span>${tree(g.inside)}</li>`).join("")}</ul>`;
}

/** Called when a value is settled (a field committed, rows imported, Baxter ticked), not on every keystroke. */
function teach() {
  baxter = learn(baxter, state.items, state.unit);
  if (baxter.on) saveBaxter();
}
function baxterPanel() {
  const el = $("baxter");
  if (!baxter.on) { el.innerHTML = ""; return; }
  const tips = suggest(baxter.seen, state.boxes, state.unit);
  el.innerHTML = `
    <h2>Baxter the Boxer</h2>
    <p class="hint">${baxter.seen.length} product shape${baxter.seen.length === 1 ? "" : "s"} learned, kept in this browser.
      ${tips.length ? "Boxes that would suit them:" : baxter.seen.length ? "Your boxes already suit what he has seen." : "Pack something and he will have an opinion."}</p>
    ${tips.map((t, i) => `<div class="row"><span>${esc(t.name)} <span class="dim">${t.size.map(num).join(" &times; ")} ${state.unit}, for ${t.covers} product${t.covers === 1 ? "" : "s"}</span></span>
      <button data-act="baxter-add" data-i="${i}">${ICON.plus} Add box</button></div>`).join("")}
    ${baxter.seen.length ? `<div class="tools"><button data-act="baxter-forget">${ICON.trash} Forget</button></div>` : ""}`;
}

let ticket = 0;
async function answer() {
  const mine = ++ticket;
  const el = $("answer");
  const input = toInput(state);
  baxterPanel();
  if (!input.boxes.length) { el.innerHTML = `<p class="msg">Add a shipping box with a size.</p>`; return; }
  if (!input.items.length) { el.innerHTML = `<p class="msg">Add a product with a size.</p>`; return; }
  let sol: Solution;
  try { sol = await solve(input.boxes, input.items, input.pad); }
  catch (e) { if (mine === ticket) el.innerHTML = `<p class="err">${esc((e as Error).message)}</p>`; return; }
  if (mine !== ticket) return;
  const v = verdict(sol);
  const names = usableBoxes(state);
  const head = v.kind === "fits"
    ? `<div class="answer yes">${ICON.check} Fits in ${esc(v.box)}</div><div class="meter" title="${Math.round(v.fill * 100)}% of the box"><i style="width:${Math.min(100, Math.round(v.fill * 100))}%"></i></div>`
    : v.kind === "none" ? `<div class="answer no">${ICON.x} Doesn't fit in any box</div>` : `<p class="msg">${v.why}</p>`;
  const pieces = group(sol.pieces);
  stopPlayer();
  scene = v.kind === "fits" ? { box: names[sol.best!]!, parts: parts(sol.packed) } : null;
  el.innerHTML = `${head}
    ${sol.nested ? `<p class="hint">${sol.nested} packed inside another.</p>` : ""}
    ${v.kind === "fits" ? `<div class="stage" id="stage"></div><div class="player" id="player"></div>` : ""}
    ${tree(pieces, true)}
    <ul class="verdicts">${sol.boxes.map((b, i) => `<li class="${b.fits ? "y" : "n"}">${b.fits ? ICON.check : ICON.x} ${esc(b.name)} <span class="dim">${num(names[i]!.l)} &times; ${num(names[i]!.w)} &times; ${num(names[i]!.h)}, ${Math.round(b.fill * 100)}% full</span></li>`).join("")}</ul>`;
  if (scene) { step = scene.parts.length; drawScene(); }
}
// The packed box as a scene, filled one piece at a time: play, loop, or scrub.
let scene: { box: { l: number; w: number; h: number }; parts: ReturnType<typeof parts> } | null = null;
let step = 0, playing = false, looping = false, tick: ReturnType<typeof setTimeout> | undefined;
const STEP_MS = 520;

function stopPlayer() { clearTimeout(tick); playing = false; }
function showStep(n: number) {
  step = n;
  document.querySelectorAll<SVGGElement>("#stage .part").forEach((g) => g.classList.toggle("on", Number(g.dataset.step) < n));
  const range = document.getElementById("scrub") as HTMLInputElement | null;
  if (range) range.value = String(n);
  const label = document.getElementById("stepno");
  if (label && scene) label.textContent = `${n} / ${scene.parts.length}`;
}
function frame() {
  if (!scene || !playing) return;
  if (step < scene.parts.length) { showStep(step + 1); tick = setTimeout(frame, STEP_MS); }
  else if (looping) { tick = setTimeout(() => { showStep(0); tick = setTimeout(frame, STEP_MS); }, STEP_MS * 3); }
  else { playing = false; drawPlayer(); }
}
function drawScene() {
  const stage = document.getElementById("stage"), player = document.getElementById("player");
  if (!stage || !player || !scene) return;
  const t = theme();
  stage.style.background = t.bg;
  stage.innerHTML = sceneSvg([scene.box.l, scene.box.w, scene.box.h], scene.parts, t);
  drawPlayer();
}
function drawPlayer() {
  const player = document.getElementById("player");
  if (!player || !scene) return;
  player.innerHTML = `
    <button data-act="play" title="${playing ? "Pause" : "Play"}" aria-label="${playing ? "Pause" : "Play"}">${playing ? ICON.pause : ICON.play}</button>
    <input type="range" id="scrub" min="0" max="${scene.parts.length}" value="${step}" aria-label="Step">
    <span class="dim" id="stepno"></span>
    <button data-act="loop" class="icon ${looping ? "on" : ""}" aria-pressed="${looping}" title="Loop" aria-label="Loop">${ICON.repeat}</button>
    <span class="swatches">${THEMES.map((th, i) => `<button class="swatch ${i === state.theme ? "on" : ""}" data-act="theme" data-theme="${i}" title="${th.name}" aria-label="${th.name} theme" aria-pressed="${i === state.theme}" style="background:linear-gradient(135deg,${th.bg} 50%,${th.pieces[0]} 50%)"></button>`).join("")}</span>`;
  showStep(step);
}

/** Plays the packing from the top (or from where it stopped), or pauses it. */
function togglePlay() {
  if (!scene) return;
  if (playing) { stopPlayer(); drawPlayer(); return; }
  playing = true;
  if (step >= scene.parts.length) showStep(0);
  drawPlayer(); tick = setTimeout(frame, 200);
}

let timer: ReturnType<typeof setTimeout> | undefined;
const later = () => { save(); clearTimeout(timer); timer = setTimeout(answer, 120); };

function render() { list("boxes"); list("items"); options(); void answer(); }

function rowOf(el: Element) {
  const rowEl = el.closest<HTMLElement>(".entry");
  const sect = el.closest<HTMLElement>("section")!.id as "boxes" | "items";
  return { sect, i: rowEl ? Number(rowEl.dataset.i) : -1 };
}

app.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "scrub") { stopPlayer(); showStep(Number(t.value)); drawPlayer(); return; }
  const k = t.dataset.k;
  if (!k) return;
  if (t.closest(".entry")) {
    const { sect, i } = rowOf(t);
    const r = state[sect][i]!;
    const entry = t.closest<HTMLElement>(".entry")!;
    if (k === "name") r.name = t.value;
    else if (k === "holds") { r.holds = t.checked; save(); list(sect); void answer(); return; }
    else if (k.startsWith("in")) r.inner = [0, 1, 2].map((n) => Number(entry.querySelector<HTMLInputElement>(`[data-k=in${n}]`)!.value) || 0) as [number, number, number];
    else (r as unknown as Record<string, number>)[k] = Number(t.value) || 0;
    // The drawing follows the numbers; so do the default inside sizes until they are typed.
    if (!r.inner) innerOf(r, state.unit).forEach((v, n) => { const f = entry.querySelector<HTMLInputElement>(`[data-k=in${n}]`); if (f) f.value = String(v); });
    entry.querySelector(".thumb")!.innerHTML = thumbOf(r, sect === "items");
  } else if (k === "unit") { state.unit = t.value as State["unit"]; render(); save(); return; }
  else if (k === "baxter") { baxter.on = t.checked; teach(); saveBaxter(); void answer(); return; }
  else if (k === "nest") state.nest = t.checked;
  else if (k === "pad") state[k] = Math.max(0, Number(t.value) || 0);
  later();
});

async function takeRows(sect: "boxes" | "items", text: string) {
  const { rows, skipped } = parseRows(text);
  if (sect === "boxes") rows.forEach((r) => (r.holds = false));
  state[sect].push(...rows);
  if (sect === "items") teach();
  save(); render();
  if (skipped) $("answer").insertAdjacentHTML("afterbegin", `<p class="hint">Skipped ${skipped} line${skipped > 1 ? "s" : ""} with no size.</p>`);
}

app.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!b) return;
  const act = b.dataset.act!;
  if (act === "example") { state = { ...example(), theme: state.theme }; save(); render(); return; }
  if (act === "baxter-forget") { baxter = { on: false, seen: [] }; saveBaxter(); options(); void answer(); return; }
  if (act === "baxter-add") {
    const t = suggest(baxter.seen, state.boxes, state.unit)[Number(b.dataset.i)];
    if (t) { state.boxes.push({ ...blank(), name: t.name, l: t.size[0], w: t.size[1], h: t.size[2] }); save(); render(); }
    return;
  }
  if (act === "play") { togglePlay(); return; }
  if (act === "loop") { looping = !looping; drawPlayer(); return; }
  if (act === "theme") { state.theme = Number(b.dataset.theme); save(); render(); return; }
  const { sect, i } = rowOf(b);
  if (act === "del") { state[sect].splice(i, 1); save(); render(); }
  else if (act === "add") { state[sect].push(blank()); save(); list(sect); void answer(); }
  else if (act === "import-toggle") {
    const slot = b.closest("section")!.querySelector<HTMLElement>("[data-slot=import]")!;
    slot.hidden = !slot.hidden;
    if (!slot.hidden) slot.querySelector("textarea")!.focus();
  } else if (act === "import") {
    const ta = b.closest("section")!.querySelector("textarea")!;
    void takeRows(sect, ta.value);
  }
});

app.addEventListener("change", async (e) => {
  const f = e.target as HTMLInputElement;
  if (baxter.on && f.closest("#items") && f.dataset.k) { teach(); baxterPanel(); }
  if (f.dataset.act !== "file" || !f.files?.[0]) return;
  await takeRows(rowOf(f).sect, await f.files[0].text());
});

// A CSV dropped on a list is the same as choosing it.
for (const id of ["boxes", "items"] as const) {
  const el = $(id);
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) await takeRows(id, await file.text());
  });
}

render();

// The page's commands (@rustybuns/util/commands): WebMCP tools for an agent in the browser, window.__commands for a
// harness, and the Cmd/Ctrl+K palette with its corner button for a person (bottom-left in style.css: eqosys's Report
// button has the bottom-right).
const arg = (a: unknown, k: string): unknown => (typeof a === "object" && a ? Reflect.get(a, k) : undefined);
const size = (a: unknown, k: string) => { const v = arg(a, k); if (typeof v !== "number" || !(v > 0)) throw new Error(`${k}: a size above 0`); return v; };
const listArg = (a: unknown) => { const v = arg(a, "list"); if (v !== "boxes" && v !== "items") throw new Error('list: "boxes" or "items"'); return v; };
const nameArg = (a: unknown) => { const v = arg(a, "name"); return typeof v === "string" ? v.slice(0, 120) : ""; };
const SIZE = { name: { type: "string" }, l: { type: "number" }, w: { type: "number" }, h: { type: "number" } };
const LIST = { type: "string", enum: ["boxes", "items"], description: "boxes: shipping boxes; items: products" };
const looks = () => ({ unit: state.unit, pad: state.pad, nest: state.nest, theme: THEMES[state.theme]?.name, baxter: baxter.on, boxes: state.boxes, items: state.items });
async function fit() {
  const input = toInput(state);
  if (!input.boxes.length || !input.items.length) return { kind: "empty", why: input.boxes.length ? "Add a product with a size." : "Add a shipping box with a size." };
  const sol = await solve(input.boxes, input.items, input.pad);
  return { ...verdict(sol), nested: sol.nested, boxes: sol.boxes.map((b) => ({ name: b.name, fits: b.fits, fill: Math.round(b.fill * 100) / 100 })), packed: group(sol.pieces) };
}
const changed = () => { save(); render(); return fit(); };
addCommands([
  { name: "gbq_state", title: "Look at the lists", group: "Lists", description: "The unit, padding, box-in-a-box, theme, Baxter, the shipping boxes (inside size) and the products (outside size, qty, holds, inner).",
    annotations: { readOnlyHint: true }, execute: looks },
  { name: "gbq_answer", title: "Will it fit?", group: "Answer", description: "Packs the products into the boxes: the best box and how full, whether each box fits, how many rode inside another, and what went where.",
    annotations: { readOnlyHint: true }, execute: fit },
  { name: "gbq_add_box", palette: false, title: "Add a shipping box", group: "Lists", description: "A shipping box by its inside size (l, w, h in the page's unit). Answers with the new fit.",
    inputSchema: { type: "object", properties: SIZE, required: ["l", "w", "h"] },
    execute: (a) => { state.boxes.push({ ...blank(), name: nameArg(a), l: size(a, "l"), w: size(a, "w"), h: size(a, "h") }); return changed(); } },
  { name: "gbq_add_product", palette: false, title: "Add a product", group: "Lists", description: "A product by its outside size (l, w, h), how many (qty, default 1), and holds: true if it opens and can carry others. Answers with the new fit.",
    inputSchema: { type: "object", properties: { ...SIZE, qty: { type: "number" }, holds: { type: "boolean" } }, required: ["l", "w", "h"] },
    execute: (a) => {
      const q = arg(a, "qty"), qty = typeof q === "number" && q >= 1 ? Math.floor(q) : 1;
      state.items.push({ ...blank(), name: nameArg(a), l: size(a, "l"), w: size(a, "w"), h: size(a, "h"), qty, holds: arg(a, "holds") === true });
      teach();
      return changed();
    } },
  { name: "gbq_import", palette: false, title: "Import rows", group: "Lists", description: "Paste rows into a list as the Import box takes them: name, length, width, height (and quantity for products), a header line, 10x8x4 in one cell, a store's product export or a carrier's box chart.",
    inputSchema: { type: "object", properties: { list: LIST, text: { type: "string" } }, required: ["list", "text"] },
    execute: async (a) => {
      const sect = listArg(a), text = arg(a, "text");
      if (typeof text !== "string") throw new Error("text: the rows");
      const before = state[sect].length;
      await takeRows(sect, text);
      return { added: state[sect].length - before, fit: await fit() };
    } },
  { name: "gbq_remove", palette: false, title: "Remove a row", group: "Lists", description: "Remove row index (from 0) of boxes or items.",
    annotations: { destructiveHint: true }, inputSchema: { type: "object", properties: { list: LIST, index: { type: "number" } }, required: ["list", "index"] },
    execute: (a) => {
      const sect = listArg(a), i = arg(a, "index");
      if (typeof i !== "number" || !Number.isInteger(i) || !state[sect][i]) throw new Error(`index: 0 to ${state[sect].length - 1}`);
      state[sect].splice(i, 1);
      return changed();
    } },
  { name: "gbq_options", palette: false, title: "Set the options", group: "Lists", description: "unit (in or cm), pad (room kept between things), nest (let boxes ride inside boxes); any left out stay as they are.",
    inputSchema: { type: "object", properties: { unit: { type: "string", enum: ["in", "cm"] }, pad: { type: "number" }, nest: { type: "boolean" } } },
    execute: (a) => {
      const unit = arg(a, "unit"), pad = arg(a, "pad"), nest = arg(a, "nest");
      if (unit === "in" || unit === "cm") state.unit = unit;
      if (typeof pad === "number" && pad >= 0) state.pad = pad;
      if (typeof nest === "boolean") state.nest = nest;
      return changed();
    } },
  { name: "gbq_example", title: "Load the example", group: "Lists", description: "Replace both lists with the example: three boxes, a gift tin, two candles and a matchbook.",
    annotations: { destructiveHint: true }, execute: () => { state = { ...example(), theme: state.theme }; return changed(); } },
  { name: "gbq_play", title: "Play the packing", group: "Answer", description: "Play the packed box filling one piece at a time, or pause it.", execute: () => { if (!scene) throw new Error("nothing fits yet"); togglePlay(); return { playing }; } },
  { name: "gbq_theme", title: "Next look", group: "Answer", description: `The packed box's look: theme by number (0 to ${THEMES.length - 1}), or the next one when left out.`,
    inputSchema: { type: "object", properties: { theme: { type: "number" } } },
    execute: (a) => { const t = arg(a, "theme"); state.theme = typeof t === "number" && THEMES[t] ? t : (state.theme + 1) % THEMES.length; save(); render(); return { theme: THEMES[state.theme]!.name }; } },
  { name: "gbq_baxter", title: "Baxter on or off", group: "Baxter", description: "Baxter the Boxer learns the product shapes packed here and suggests box sizes (kept in this browser). on: true or false; left out, it toggles.",
    inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
    execute: (a) => { const on = arg(a, "on"); baxter.on = typeof on === "boolean" ? on : !baxter.on; teach(); saveBaxter(); options(); void answer(); return { on: baxter.on, learned: baxter.seen.length, suggest: baxter.on ? suggest(baxter.seen, state.boxes, state.unit) : [] }; } },
]);
mountPalette({ button: true });
