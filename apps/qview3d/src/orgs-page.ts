// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The shops page (public/orgs.html): sign in with eqosys and see your studios. A studio's owner or admin sets up its
// products, copies the embed tag and makes a key for a script; QView3D's owner (the house studio) makes the org for
// a studio from its id, which the friend copies from this same page.
import { eqosys } from "@rustybuns/util/eqosys";
import { getJson } from "@rustybuns/util/http";
import { APP, EQOSYS, KeyReply, Mine, MODELS } from "./api.ts";
import { problem } from "./widget/upload.ts";

/** Where eqosys sends people back: this page on the live Worker (eqosys APPS `returns`). */
const SITE = "https://qview3d.notryanquinn.workers.dev";
const eq = eqosys({ app: APP, url: EQOSYS, from: [SITE], prefix: "qview3d" });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // the page's own elements, by id
const status = $<HTMLDivElement>("status"), shopsEl = $<HTMLDivElement>("shops"), who = $<HTMLSpanElement>("who");
const signin = $<HTMLButtonElement>("signin"), signout = $<HTMLButtonElement>("signout"), out = $<HTMLElement>("signed-out");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(e, rest);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
const say = (text: string, bad = false) => { status.textContent = text; status.classList.toggle("bad", bad); };
const token = () => { const l = eq.login(); return l && eq.fresh(l, 5_000) ? l.token : null; };

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const t = token();
  if (!t) throw new Error("Your sign-in ran out. Sign in again.");
  const res = await fetch(path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await problem(res));
  return res;
}
const act = (f: () => Promise<unknown>) => async (e?: Event) => {
  e?.preventDefault();
  try { await f(); } catch (err) { say(err instanceof Error ? err.message : String(err), true); }
};

function field(label: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  return el("label", { class: "field" }, label, input);
}
function copyBox(title: string, text: string) {
  const copy = el("button", { class: "copy", type: "button", textContent: "Copy" });
  copy.onclick = () => void navigator.clipboard.writeText(text).then(() => say("Copied."));
  return el("div", { class: "tagbox" }, el("div", { class: "bar" }, el("span", {}, title), copy), el("pre", { textContent: text }));
}

/** The owner's form: an org for a studio, or new sites and allowance for one already made. */
function ownerCard(reload: () => Promise<void>) {
  const org = el("input", { type: "text", placeholder: "fern-hats", spellcheck: false, required: true, pattern: "[a-z0-9][a-z0-9-]{0,62}" });
  const studio = el("input", { type: "text", placeholder: "the studio id they copied", spellcheck: false, required: true });
  const sites = el("textarea", { rows: 3, placeholder: "https://fernhats.com", required: true });
  const samples = el("input", { type: "number", min: "0", max: "10000", value: "0" });
  const form = el("form", {}, field("Org id (in the embed tag)", org), field("Their studio id", studio), field("Sites, one a line", sites), field("Samples paid for", samples),
    el("button", { class: "go", type: "submit", textContent: "Make the shop" }));
  form.onsubmit = act(async () => {
    const origins = sites.value.split(/\s+/).filter(Boolean).map((s) => s === "*" ? s : new URL(s).origin);
    await send(`/api/orgs/${encodeURIComponent(org.value.trim())}`, "PUT", { studio: studio.value.trim(), origins, samples: Number(samples.value) || 0 });
    say(`Shop ${org.value.trim()} is set up. Its owner sees it here when they sign in.`);
    form.reset();
    await reload();
  });
  return el("section", { class: "card" }, el("div", { class: "head" }, el("h1", { textContent: "Make a shop" }), el("p", { class: "sub", textContent: "For a friend's studio: they copy its id from this page." })), el("div", { class: "body" }, form));
}

function productForm(org: string, reload: () => Promise<void>) {
  const id = el("input", { type: "text", placeholder: "trucker-cap", spellcheck: false, required: true, pattern: "[a-z0-9][a-z0-9-]{0,62}" });
  const name = el("input", { type: "text", placeholder: "Trucker cap", required: true, maxLength: 120 });
  const model = el("select", {}, ...MODELS.map((m) => el("option", { value: m, textContent: m })));
  const colors = el("input", { type: "text", value: "#1f2937, #f4efe6, #b91c1c", spellcheck: false });
  const form = el("form", {}, el("div", { class: "row" }, field("Product id", id), field("Name", name)), el("div", { class: "row" }, field("Kind", model), field("Colours", colors)),
    el("button", { class: "go", type: "submit", textContent: "Save the product" }));
  form.onsubmit = act(async () => {
    const list = colors.value.split(/[\s,]+/).filter(Boolean);
    await send(`/api/orgs/${org}/products/${encodeURIComponent(id.value.trim())}`, "PUT", { name: name.value.trim(), model: model.value, colors: list });
    say(`Saved ${name.value.trim()}.`);
    await reload();
  });
  return form;
}

function shopCard(shop: Mine["shops"][number], reload: () => Promise<void>) {
  const runs = shop.role !== "maker";
  const body = el("div", { class: "body" });
  const card = el("section", { class: "card" }, el("div", { class: "head" }, el("h1", { textContent: shop.name }), el("p", { class: "sub", textContent: `You are its ${shop.role}.` })), body);
  const o = shop.org;
  if (!o) {
    body.append(el("p", { textContent: "Not set up yet. Send this id to QNTBR (hello@qntbr.com) with your shop's web address, and it shows up here." }), copyBox("Your studio id", shop.studio));
    return card;
  }
  body.append(el("p", { class: "sub", textContent: `Org ${o.id}. Sites: ${o.origins.join(", ")}. Samples: ${o.samples}. Script keys: ${o.keys}.` }));
  const list = el("ul", { class: "products" }, ...o.products.map((p) =>
    el("li", {}, el("b", { textContent: p.name }), ` ${p.model}`, el("span", { class: "swatches" }, ...p.colors.map((c) => { const i = el("i", { title: c }); i.style.background = c; return i; })))));
  body.append(o.products.length ? list : el("p", { class: "sub", textContent: "No products yet." }));
  const first = o.products[0]?.id ?? "your-product";
  body.append(copyBox("Paste into your product page", `<script type="module" src="${location.origin}/v1/qview3d.js"></script>\n<qview-3d org="${o.id}" product="${first}"></qview-3d>`));
  if (!runs) return card;
  body.append(el("h2", { textContent: "Add or change a product" }), productForm(o.id, reload));
  const key = el("button", { class: "copy", type: "button", textContent: "New script key" });
  const shown = el("div");
  key.onclick = act(async () => {
    const got = KeyReply(await (await send(`/api/orgs/${o.id}/keys`, "POST", {})).json());
    shown.replaceChildren(copyBox("Shown once: keep it somewhere safe", got.key));
    await reload();
  });
  body.append(el("div", { class: "keys" }, key, el("a", { href: "/admin.html", textContent: "Make a sample" })), shown);
  return card;
}

async function load() {
  const t = token();
  signin.hidden = !!t || !eq.canSignIn();
  signout.hidden = !t;
  out.hidden = !!t;
  who.textContent = t ? (eq.login()?.name ?? "") : "";
  if (!t) { shopsEl.replaceChildren(); return; }
  const mine = await getJson("/api/mine", Mine, { headers: { authorization: `Bearer ${t}` } });
  if (!mine) return say("Couldn't read your shops. Sign in again.", true);
  shopsEl.replaceChildren(...(mine.owner ? [ownerCard(load)] : []), ...mine.shops.map((s) => shopCard(s, load)));
  if (!mine.shops.length) say("Your eqosys account isn't in a studio yet. Make one on eqosys (Studio tab), then come back.");
}

signin.onclick = () => void eq.signIn();
signout.onclick = () => { eq.signOut(); void load(); };
if (!eq.canSignIn()) $<HTMLElement>("local").hidden = false;
const back = await eq.finishSignIn().catch(() => null);
if (back?.error) say(back.error, true);
await act(load)();
