// The page: two lists (boxes, products), one answer. Everything is computed here, in the browser, and kept in
// localStorage; nothing about your boxes leaves the machine.
import { solve, type Solution } from "./engine.ts";
import { blank, example, group, parseRows, toInput, usableBoxes, verdict, type Group, type Row, type State } from "./model.ts";

// Lucide icons (24-unit grid, stroke), inline so the page loads no icon font.
const icon = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  package: icon('<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zM12 22V12M3.3 7 12 12l8.7-5"/>'),
  plus: icon('<path d="M5 12h14M12 5v14"/>'),
  trash: icon('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  upload: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  sparkles: icon('<path d="M9.94 14.06 9 17l-.94-2.94L5 13l3.06-.94L9 9l.94 3.06L13 13zM19 3v4M21 5h-4M19 17v4M21 19h-4"/>'),
};

const KEY = "boxfit:v1";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (n: number) => String(Math.round(n * 100) / 100);

function load(): State {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s) as State; } catch { /* private window: start fresh */ }
  return example();
}
let state = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept */ } };

const app = document.getElementById("app")!;
app.innerHTML = `
  <h1>${ICON.package} boxFit</h1>
  <p class="lede">Will it fit in the box? Including a box in a box in a box.</p>
  <section id="boxes"></section>
  <section id="items"></section>
  <section class="options" id="options"></section>
  <section id="answer" aria-live="polite"></section>`;
const $ = (id: string) => document.getElementById(id)!;

const field = (r: Row, k: "l" | "w" | "h", label: string) =>
  `<input type="number" min="0" step="any" inputmode="decimal" data-k="${k}" value="${r[k] || ""}" aria-label="${label}" placeholder="${label[0]}">`;

function list(id: "boxes" | "items") {
  const items = id === "items";
  const rows = state[id];
  $(id).innerHTML = `
    <h2>${items ? "Products" : "Shipping boxes"}</h2>
    <p class="hint">${items ? "Outside size. Tick the checkbox on anything that opens and can carry other things." : "Inside size, what actually fits."} In ${state.unit}.</p>
    ${rows.map((r, i) => `
      <div class="row ${items ? "item" : ""}" data-i="${i}">
        <input class="name" data-k="name" value="${esc(r.name)}" placeholder="Name" aria-label="Name">
        ${field(r, "l", "Length")}${field(r, "w", "Width")}${field(r, "h", "Height")}
        ${items ? `<input type="number" min="1" step="1" data-k="qty" value="${r.qty}" aria-label="How many">
          <label title="Opens and can hold other products"><input type="checkbox" data-k="holds" ${r.holds ? "checked" : ""} aria-label="Opens and can hold other products"></label>` : ""}
        <button class="icon" data-act="del" title="Remove" aria-label="Remove">${ICON.trash}</button>
      </div>`).join("")}
    <div class="tools">
      <button data-act="add">${ICON.plus} Add</button>
      <button data-act="import-toggle">${ICON.upload} Import</button>
      <input type="file" accept=".csv,.tsv,.txt" hidden data-act="file">
    </div>
    <div data-slot="import" hidden>
      <textarea placeholder="${items ? "Gift tin, 7, 5, 3.5, 1\nCandle, 3, 3, 3.5, 2" : "Small, 8, 6, 4\nMedium, 12x9x6"}" aria-label="Paste rows"></textarea>
      <p class="hint">Paste rows or drop a CSV: name, length, width, height${items ? ", quantity" : ""}. A header line works, and so does 10x8x4 in one cell.</p>
      <button data-act="import">${ICON.check} Add these</button>
    </div>`;
}

function options() {
  $("options").innerHTML = `
    <label>Unit <select data-k="unit"><option ${state.unit === "in" ? "selected" : ""}>in</option><option ${state.unit === "cm" ? "selected" : ""}>cm</option></select></label>
    <label>Padding <input type="number" min="0" step="any" data-k="pad" value="${state.pad}"></label>
    <label>Box wall <input type="number" min="0" step="any" data-k="wall" value="${state.wall}"></label>
    <label><input type="checkbox" data-k="nest" ${state.nest ? "checked" : ""}> Box in a box</label>
    <button data-act="example">${ICON.sparkles} Example</button>`;
}

function tree(gs: Group[], top = false): string {
  if (!gs.length) return "";
  return `<ul${top ? ' class="tree"' : ""}>${gs.map((g) => `<li>${esc(g.name)}${g.count > 1 ? ` &times; ${g.count}` : ""} <span class="dim">${g.size.map(num).join(" &times; ")}</span>${tree(g.inside)}</li>`).join("")}</ul>`;
}

let ticket = 0;
async function answer() {
  const mine = ++ticket;
  const el = $("answer");
  const input = toInput(state);
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
  el.innerHTML = `${head}
    ${sol.nested ? `<p class="hint">${sol.nested} packed inside another.</p>` : ""}
    ${tree(pieces, true)}
    <ul class="verdicts">${sol.boxes.map((b, i) => `<li class="${b.fits ? "y" : "n"}">${b.fits ? ICON.check : ICON.x} ${esc(b.name)} <span class="dim">${num(names[i]!.l)} &times; ${num(names[i]!.w)} &times; ${num(names[i]!.h)}, ${Math.round(b.fill * 100)}% full</span></li>`).join("")}</ul>`;
}
let timer: ReturnType<typeof setTimeout> | undefined;
const later = () => { save(); clearTimeout(timer); timer = setTimeout(answer, 120); };

function render() { list("boxes"); list("items"); options(); void answer(); }

function rowOf(el: Element) {
  const rowEl = el.closest<HTMLElement>(".row");
  const sect = el.closest<HTMLElement>("section")!.id as "boxes" | "items";
  return { sect, i: rowEl ? Number(rowEl.dataset.i) : -1 };
}

app.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  const k = t.dataset.k;
  if (!k) return;
  if (t.closest(".row")) {
    const { sect, i } = rowOf(t);
    const r = state[sect][i]!;
    if (k === "name") r.name = t.value;
    else if (k === "holds") r.holds = t.checked;
    else (r as unknown as Record<string, number>)[k] = Number(t.value) || 0;
  } else if (k === "unit") { state.unit = t.value as State["unit"]; render(); save(); return; }
  else if (k === "nest") state.nest = t.checked;
  else if (k === "pad" || k === "wall") state[k] = Math.max(0, Number(t.value) || 0);
  later();
});

async function takeRows(sect: "boxes" | "items", text: string) {
  const { rows, skipped } = parseRows(text);
  if (sect === "boxes") rows.forEach((r) => (r.holds = false));
  state[sect].push(...rows);
  save(); render();
  if (skipped) $("answer").insertAdjacentHTML("afterbegin", `<p class="hint">Skipped ${skipped} line${skipped > 1 ? "s" : ""} with no size.</p>`);
}

app.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!b) return;
  const act = b.dataset.act!;
  if (act === "example") { state = example(); save(); render(); return; }
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
