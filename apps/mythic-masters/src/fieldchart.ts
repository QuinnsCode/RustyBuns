// The field chart: what the twelve fields do to each other, kept behind a field wheel under the Settings cog. It opens
// as a modal over whatever you were doing (a fight, the world, a page of the tome) and shuts back onto it, and keeps
// its own scroll and picks between openings. Three parts: how fields work, the whole 12 x 12 grid, and an asker
// (your creature's fields against theirs, both ways). Everything it says is read from fields.ts, so it can't drift.
import { FIELDS, GLYPH, hex, KIN, MARK, STRONG, typeMul, type Field } from "./fields.ts";
import { icon } from "./icons.ts";

export type Lean = "strong" | "resisted" | "even";
/** One move field into a creature of one or two fields: the damage multiplier, each field's own lean, and
 * whether the cap trimmed it (two fields leaning the same way still stop at one lean). */
export interface Matchup { move: Field; target: Field[]; mul: number; lean: Lean; parts: { field: Field; lean: Lean }[]; capped: boolean }

const leanOf = (mul: number): Lean => (mul > 1 ? "strong" : mul < 1 ? "resisted" : "even");
const STEP = { strong: typeMul(FIELDS[0], [STRONG[FIELDS[0]][0]!]) - 1, resisted: 1 - typeMul(FIELDS[0], [FIELDS[0]]) };

export function matchup(move: Field, target: readonly Field[]): Matchup {
  const parts = target.map((field) => ({ field, lean: leanOf(typeMul(move, [field])) }));
  const raw = 1 + parts.reduce((s, p) => s + (p.lean === "strong" ? STEP.strong : p.lean === "resisted" ? -STEP.resisted : 0), 0);
  const mul = typeMul(move, target);
  return { move, target: [...target], mul, lean: leanOf(mul), parts, capped: Math.abs(raw - mul) > 1e-9 };
}

/** "+12.5%", "-10%", "even". */
export const pct = (mul: number) => {
  const p = Math.round((mul - 1) * 1000) / 10;
  return p === 0 ? "even" : `${p > 0 ? "+" : "-"}${Math.abs(p)}%`;
};

/** Why one field leans against another, in a few words. */
function because(move: Field, t: Field, lean: Lean) {
  if (lean === "strong") return `${move} beats ${t}`;
  if (lean === "resisted") return move === t ? `${t} shrugs off its own field` : `${t} beats ${move}, so it shrugs it off`;
  return `${move} and ${t} pass each other by`;
}

/** The asker's answer: a sentence for one move field into a creature, read off its matchup. */
export function explain(m: Matchup) {
  const why = m.parts.map((p) => because(m.move, p.field, p.lean));
  const both = m.parts.length > 1 && m.parts[0]!.lean !== "even" && m.parts[1]!.lean !== "even" && m.parts[0]!.lean !== m.parts[1]!.lean;
  return `${why.join("; ")}${m.capped ? `. Both lean the same way, but one lean is the most a matchup gives` : both ? `. The two leans nearly cancel` : ""}.`;
}

/** Your creature's fields against theirs, both ways: every one of your fields into them, and theirs into you. */
export function ask(you: readonly Field[], them: readonly Field[]) {
  return { yours: you.map((f) => matchup(f, them)), theirs: them.map((f) => matchup(f, you)) };
}

/** Field pairs that beat each other both ways (a hit either way lands harder). */
export const mutual = () => FIELDS.flatMap((a, i) => FIELDS.slice(i + 1).filter((b) => STRONG[a].includes(b) && STRONG[b].includes(a)).map((b) => [a, b] as const));

// --- the page ----------------------------------------------------------------------------------------------------
const glyph = (f: Field, cls = "fc-g") => `<span class="${cls}" style="--c:${hex(f)}" title="${f}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[f]}</svg></span>`;
const name = (f: Field) => `<b class="fc-name" style="--c:${hex(f)}">${f}</b>`;
const MARKS = { strong: "+", resisted: "−", even: "" };

function howHtml() {
  const s = pct(1 + STEP.strong), r = pct(1 - STEP.resisted), pairs = mutual();
  return `<h3>How fields work</h3>
<p>Every beast is born of one or two fields, and every move it throws carries one. When a move lands, its field meets the fields of the one it hits:</p>
<ul class="fc-rules">
  <li><span class="fc-cell strong">+</span><span>Into a field it <i>beats</i>, the hit lands <b>${s}</b> harder.</span></li>
  <li><span class="fc-cell resisted">${MARKS.resisted}</span><span>Into a field that beats it, or into <i>its own</i> field, the hit lands <b>${r.slice(1)}</b> softer.</span></li>
  <li><span class="fc-cell even"></span><span>Anything else passes by, even.</span></li>
</ul>
<p>Against two fields, each one leans, but the total never goes past ${s} or ${r}: two leans the same way count as one, and a lean each way nearly cancels.</p>
${pairs.length ? `<p>A few pairs beat each other both ways, so whoever lands first lands harder: ${pairs.map(([a, b]) => `${name(a)} and ${name(b)}`).join(", ")}.</p>` : ""}
<p class="dim">A matchup leans, it doesn't decide: size, weight and how you fight still win it. A beast can also be taught (never born knowing) the moves of its fields' neighbours, so a creature can carry an answer to what beats it.</p>
<h3>What each field leaves behind</h3>
<ul class="fc-marks">${FIELDS.map((f) => `<li>${glyph(f)}<span>${name(f)} ${MARK[f]}. <small>Beats ${STRONG[f].join(", ")}. Taught: ${KIN[f].join(", ")}.</small></span></li>`).join("")}</ul>`;
}

function gridHtml() {
  const head = `<tr><th class="fc-corner"><small>move</small><small>into</small></th>${FIELDS.map((d, c) => `<th scope="col" data-c="${c}">${glyph(d)}</th>`).join("")}</tr>`;
  const rows = FIELDS.map((a, r) => `<tr><th scope="row" data-r="${r}">${glyph(a)}<span class="fc-rn">${a}</span></th>${FIELDS.map((d, c) => {
    const m = matchup(a, [d]);
    return `<td class="fc-cell ${m.lean}" data-r="${r}" data-c="${c}" title="${a} into ${d}: ${pct(m.mul)}">${MARKS[m.lean]}</td>`;
  }).join("")}</tr>`).join("");
  return `<h3>The whole chart</h3><p class="dim">Rows are the move, columns the beast it hits. Tap a square to ask about it below.</p>
<div class="fc-wrap"><table class="fc-table" aria-label="Field against field">${head}${rows}</table></div>`;
}

const chips = (side: "you" | "them") => `<div class="fc-chips" data-side="${side}" role="group">${FIELDS.map((f) => `<button type="button" data-f="${f}" aria-pressed="false" title="${f}" aria-label="${f}">${glyph(f)}</button>`).join("")}</div>`;
function askHtml() {
  return `<h3>This against that</h3><p class="dim">Pick one or two fields a side.</p>
<div class="fc-side"><h4>You</h4>${chips("you")}</div>
<div class="fc-side"><h4>Them</h4>${chips("them")}</div>
<div class="fc-answer" aria-live="polite"></div>`;
}

function answerHtml(you: Field[], them: Field[]) {
  if (!you.length || !them.length) return `<p class="dim">Pick a field on each side.</p>`;
  const a = ask(you, them), who = (fs: Field[]) => fs.map(name).join(" + ");
  const row = (m: Matchup) => `<li class="${m.lean}"><span class="fc-big">${pct(m.mul)}</span><span>${glyph(m.move)} ${name(m.move)} moves into ${who(m.target)}: <small>${explain(m)}</small></span></li>`;
  return `<h4>Your moves into ${who(them)}</h4><ul>${a.yours.map(row).join("")}</ul><h4>Their moves into ${who(you)}</h4><ul>${a.theirs.map(row).join("")}</ul>`;
}

/** The field wheel button (in `host`, by the Settings cog) and the chart it opens. `onToggle` hears it open and shut,
 * so the fight and the walk can wait while it is up. */
export function mountFieldChart(host: HTMLElement, onToggle: (open: boolean) => void = () => {}) {
  const wheel = FIELDS.map((f, i) => `${hex(f)} ${(i * 30).toFixed(0)}deg ${((i + 1) * 30).toFixed(0)}deg`).join(", ");
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "fc-open", title: "Field chart", ariaLabel: "Field chart" });
  btn.innerHTML = `<i style="background:conic-gradient(${wheel})"></i>`;
  host.append(btn);

  const dlg = Object.assign(document.createElement("dialog"), { className: "fchart paper", ariaLabel: "The field chart" });
  dlg.innerHTML = `<div class="fc-scroll"><header><h2>The Field Chart</h2>
<nav class="fc-jump"><button type="button" data-to="how">How it works</button><button type="button" data-to="grid">Chart</button><button type="button" data-to="ask">Ask</button></nav>
<button type="button" class="fc-x" title="Close (Esc)" aria-label="Close">${icon("x")}</button></header>
<section data-part="how">${howHtml()}</section><section data-part="grid">${gridHtml()}</section><section data-part="ask">${askHtml()}</section></div>`;
  document.body.append(dlg);
  const scroll = dlg.querySelector<HTMLElement>(".fc-scroll")!, table = dlg.querySelector<HTMLTableElement>(".fc-table")!;
  const answer = dlg.querySelector<HTMLElement>(".fc-answer")!, part = (p: string) => dlg.querySelector<HTMLElement>(`[data-part="${p}"]`)!;

  const picks: Record<"you" | "them", Field[]> = { you: ["ember"], them: ["grove"] };
  const draw = () => {
    for (const side of ["you", "them"] as const) for (const b of dlg.querySelectorAll<HTMLButtonElement>(`[data-side="${side}"] button`)) b.setAttribute("aria-pressed", String(picks[side].some((f) => f === b.dataset.f)));
    answer.innerHTML = answerHtml(picks.you, picks.them);
  };
  /** Up to two fields a side: a third pick drops the older one; picking one again takes it off. */
  const pick = (side: "you" | "them", f: Field) => {
    const p = picks[side];
    picks[side] = p.includes(f) ? p.filter((x) => x !== f) : [...p, f].slice(-2);
    draw();
  };
  const choose = (you: Field[], them: Field[]) => { picks.you = you.slice(0, 2); picks.them = them.slice(0, 2); draw(); };
  const head = dlg.querySelector<HTMLElement>("header")!;
  const to = (p: string) => scroll.scrollTo({ top: part(p).offsetTop - scroll.offsetTop - head.offsetHeight + 8, behavior: "smooth" });
  draw();

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) return void dlg.close(); // the backdrop
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest(".fc-x")) return void dlg.close();
    const jump = t?.closest<HTMLElement>("[data-to]");
    if (jump) return to(jump.dataset.to!);
    const chip = t?.closest<HTMLElement>(".fc-chips button"), side = chip?.closest<HTMLElement>(".fc-chips")?.dataset.side;
    const f = FIELDS.find((x) => x === chip?.dataset.f);
    if (f && (side === "you" || side === "them")) return pick(side, f);
    const cell = t?.closest<HTMLElement>("td[data-r]"), a = FIELDS[Number(cell?.dataset.r)], d = FIELDS[Number(cell?.dataset.c)];
    if (a && d) { choose([a], [d]); to("ask"); }
  });
  // the row and column of the square under the pointer light up, so a square is easy to read off the edges
  table.addEventListener("pointerover", (e) => {
    const c = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-r], [data-c]") : null;
    for (const el of table.querySelectorAll(".lit")) el.classList.remove("lit");
    if (!c) return;
    for (const el of table.querySelectorAll(`[data-r="${c.dataset.r}"]:is(th), [data-c="${c.dataset.c}"]:is(th), td[data-r="${c.dataset.r}"], td[data-c="${c.dataset.c}"]`)) el.classList.add("lit");
  });
  table.addEventListener("pointerleave", () => { for (const el of table.querySelectorAll(".lit")) el.classList.remove("lit"); });
  dlg.addEventListener("close", () => { onToggle(false); btn.focus(); });

  const open = () => { if (!dlg.open) { dlg.showModal(); onToggle(true); } };
  btn.addEventListener("click", open);
  return {
    open, close: () => dlg.close(), ask: choose,
    state: () => ({ open: dlg.open, you: [...picks.you], them: [...picks.them], answer: answer.innerText }),
  };
}
