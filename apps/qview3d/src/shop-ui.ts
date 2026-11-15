// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// What the shops page (orgs-page.ts) and the sandbox page (try-page.ts) both draw: elements, a copy box, the embed
// tag, and the product editor. Each page brings its own `send` (an eqosys token, or the sandbox's admin key).
import { MODELS, ZONES, zonesOf, type Model, type Shop, type ZoneName } from "./api.ts";
import { fieldsOf, productBody, type ProductFields } from "./product-form.ts";

/** A JSON request to this host, signed in the page's own way; it throws the server's reason when refused. */
export type Send = (path: string, method: string, body: unknown) => Promise<Response>;
/** The page's status line. */
export type Say = (text: string, bad?: boolean) => void;
type Row = Shop["products"][number];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(e, rest);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

export function field(label: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  return el("label", { class: "field" }, label, input);
}

export function copyBox(title: string, text: string, say: Say) {
  const copy = el("button", { class: "copy", type: "button", textContent: "Copy" });
  copy.onclick = () => void navigator.clipboard.writeText(text).then(() => say("Copied."));
  return el("div", { class: "tagbox" }, el("div", { class: "bar" }, el("span", {}, title), copy), el("pre", { textContent: text }));
}

/** The two lines a shop pastes into its product page. */
export const embedTag = (origin: string, org: string, product: string) =>
  `<script type="module" src="${origin}/v1/qview3d.js"></script>\n<qview-3d org="${org}" product="${product}"></qview-3d>`;

/** Turns a handler into one that shows its error on the status line instead of throwing. */
export const act = (say: Say, f: () => Promise<unknown>) => async (e?: Event) => {
  e?.preventDefault();
  try { await f(); } catch (err) { say(err instanceof Error ? err.message : String(err), true); }
};

/** Add a product, or change one: `edit(row)` fills the form with a saved one. Every field goes through productBody. */
export function productForm(org: string, send: Send, say: Say, reload: () => Promise<void>) {
  const id = el("input", { type: "text", placeholder: "trucker-cap", spellcheck: false, required: true, pattern: "[a-z0-9][a-z0-9-]{0,62}" });
  const name = el("input", { type: "text", placeholder: "Trucker cap", required: true, maxLength: 120 });
  const kinds: Model[] = [...MODELS, "custom"];
  const model = el("select", {}, ...kinds.map((m) => el("option", { value: m, textContent: m === "custom" ? "your own model (a sample)" : m })));
  const colors = el("input", { type: "text", value: "#1f2937, #f4efe6, #b91c1c", spellcheck: false });
  const kind = (): Model => kinds.find((k) => k === model.value) ?? "cap";
  const swatches = el("span", { class: "swatches" });
  const zones = el("div", { class: "zones" });
  const pct = (placeholder: string) => el("input", { type: "number", min: "0", max: "100", step: "1", placeholder });
  const across = pct("50"), up = pct("50"), size = pct("40");
  let keep: ProductFields["keep"];
  let ticked: ZoneName[] = [...ZONES];

  const drawSwatches = () => swatches.replaceChildren(...colors.value.split(/[\s,]+/).filter(Boolean).map((c) => { const i = el("i", { title: c }); i.style.background = c; return i; }));
  const drawZones = () => zones.replaceChildren(...zonesOf(kind()).map((z) => {
    const box = el("input", { type: "checkbox", checked: ticked.includes(z) });
    box.onchange = () => { ticked = box.checked ? [...ticked, z] : ticked.filter((t) => t !== z); };
    return el("label", { class: "zone" }, box, ` ${z.replace("-", " ")}`);
  }));
  colors.oninput = drawSwatches;
  model.onchange = () => { ticked = [...ZONES]; drawZones(); };
  drawSwatches(); drawZones();

  const save = el("button", { class: "go", type: "submit", textContent: "Save the product" });
  const form = el("form", {},
    el("div", { class: "row" }, field("Product id", id), field("Name", name)),
    el("div", { class: "row" }, field("Kind", model), field("Colours, first one shown first", colors)), swatches,
    el("fieldset", {}, el("legend", { textContent: "Prints on" }), zones),
    el("fieldset", {}, el("legend", { textContent: "Where a new picture lands, in % (blank: the middle)" }),
      el("div", { class: "row three" }, field("Across", across), field("Up", up), field("Size", size))),
    save);
  form.onsubmit = act(say, async () => {
    const fields: ProductFields = { name: name.value, model: kind(), colors: colors.value, print: ticked, across: across.value, up: up.value, size: size.value, keep };
    await send(`/api/orgs/${org}/products/${encodeURIComponent(id.value.trim())}`, "PUT", productBody(fields));
    say(`Saved ${name.value.trim()}.`);
    await reload();
  });
  const edit = (row: Row) => {
    const f = fieldsOf(row.product);
    id.value = row.id; name.value = f.name; model.value = f.model; colors.value = f.colors;
    across.value = f.across; up.value = f.up; size.value = f.size; keep = f.keep; ticked = f.print;
    drawSwatches(); drawZones();
    save.textContent = `Save ${f.name}`;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return { form, edit };
}
