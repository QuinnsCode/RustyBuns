// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The shops page (public/orgs.html): sign in with eqosys and see your studios. A studio's owner or admin sets up its
// products, copies the embed tag and makes a key for a script; QView3D's owner (the house studio) makes the org for
// a studio from its id, which the friend copies from this same page, or hands someone a sandbox link (sandboxes.ts).
import { eqosys } from "@rustybuns/util/eqosys";
import { getJson } from "@rustybuns/util/http";
import { APP, EQOSYS, KeyReply, Mine, SandboxReply, type SandboxRequest, type Sites } from "./api.ts";
import { act as acting, copyBox as copying, el, embedTag, field, productForm as editor } from "./shop-ui.ts";
import { problem } from "./widget/upload.ts";

/** Where eqosys sends people back: this page on the live Worker (eqosys APPS `returns`). */
const SITE = "https://qview3d.notryanquinn.workers.dev";
const eq = eqosys({ app: APP, url: EQOSYS, from: [SITE], prefix: "qview3d" });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // the page's own elements, by id
const status = $<HTMLDivElement>("status"), shopsEl = $<HTMLDivElement>("shops"), who = $<HTMLSpanElement>("who");
const signin = $<HTMLButtonElement>("signin"), signout = $<HTMLButtonElement>("signout"), out = $<HTMLElement>("signed-out");

const say = (text: string, bad = false) => { status.textContent = text; status.classList.toggle("bad", bad); };
const token = () => { const l = eq.login(); return l && eq.fresh(l, 5_000) ? l.token : null; };

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const t = token();
  if (!t) throw new Error("Your sign-in ran out. Sign in again.");
  const res = await fetch(path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await problem(res));
  return res;
}
const act = (f: () => Promise<unknown>) => acting(say, f);
const copyBox = (title: string, text: string) => copying(title, text, say);
const productForm = (org: string, reload: () => Promise<void>) => editor(org, send, say, reload);

/**
 * The owner's hand-off: a sandbox for someone to try QView3D with their own product, as one link to send. They need
 * no account; the link opens /try.html with the org and its key, and lasts the days asked for.
 */
function sandboxCard() {
  const who = el("input", { type: "text", placeholder: "Fern Hats", maxLength: 60 });
  const samples = el("input", { type: "number", min: "0", max: "5", value: "1" });
  const days = el("input", { type: "number", min: "1", max: "90", value: "14" });
  const made = el("div");
  const form = el("form", {}, field("Who it's for (goes in the org id)", who),
    el("div", { class: "row" }, field("Samples of their own product (Meshy credits)", samples), field("Days it lasts", days)),
    el("button", { class: "go", type: "submit", textContent: "Make the sandbox link" }));
  form.onsubmit = act(async () => {
    const asked: SandboxRequest = { ...(who.value.trim() ? { for: who.value.trim() } : {}), samples: Number(samples.value) || 0, days: Number(days.value) || 14 };
    const got = SandboxReply(await (await send("/api/sandboxes", "POST", asked)).json());
    const until = new Date(got.expires).toLocaleDateString(undefined, { month: "long", day: "numeric" });
    made.replaceChildren(
      copyBox("The message to send (the link is shown once)", `Here's a sandbox to try QView3D, the 3D product customiser, with your own product. No sign-up: open the link, set up your product, and copy it onto your page as a tag, an iframe, or a line for your coding agent. It lasts until ${until}.\n\n${got.link}`),
      el("p", { class: "sub", textContent: `Org ${got.org}. To make it a real shop later, use that org id in Make a shop below: it keeps their products.` }));
    say(`Sandbox ${got.org} is ready.`);
    form.reset();
  });
  return el("section", { class: "card" }, el("div", { class: "head" }, el("h1", { textContent: "Hand off a sandbox" }), el("p", { class: "sub", textContent: "A test shop for someone to try with their own product. One link, no sign-in." })), el("div", { class: "body" }, form, made));
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

/** The shop's own sites: the pages that may embed the widget. */
function sitesForm(org: string, origins: string[], reload: () => Promise<void>) {
  const sites = el("textarea", { rows: 3, value: origins.join("\n"), required: true });
  const form = el("form", {}, field("Sites, one a line (https://yourshop.com)", sites), el("button", { class: "go", type: "submit", textContent: "Save the sites" }));
  form.onsubmit = act(async () => {
    const list = sites.value.split(/\s+/).filter(Boolean).map((s) => s === "*" ? s : new URL(s).origin);
    await send(`/api/orgs/${org}/sites`, "PUT", { origins: list } satisfies Sites);
    say("Saved the sites.");
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
  const editor = runs ? productForm(o.id, reload) : null;
  const list = el("ul", { class: "products" }, ...o.products.map((row) => {
    const p = row.product;
    const li = el("li", {}, el("b", { textContent: p.name }), ` ${p.model}`, el("span", { class: "swatches" }, ...p.colors.map((c) => { const i = el("i", { title: c }); i.style.background = c; return i; })));
    if (editor) {
      const change = el("button", { class: "copy", type: "button", textContent: "Change" });
      change.onclick = () => editor.edit(row);
      li.append(change);
    }
    return li;
  }));
  body.append(o.products.length ? list : el("p", { class: "sub", textContent: "No products yet." }));
  const first = o.products[0]?.id ?? "your-product";
  body.append(copyBox("Paste into your product page", embedTag(location.origin, o.id, first)));
  if (!editor) return card;
  body.append(el("h2", { textContent: "Add or change a product" }), editor.form);
  body.append(el("h2", { textContent: "Your sites" }), sitesForm(o.id, o.origins, reload));
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
  shopsEl.replaceChildren(...(mine.owner ? [sandboxCard(), ownerCard(load)] : []), ...mine.shops.map((s) => shopCard(s, load)));
  if (!mine.shops.length) say("Your eqosys account isn't in a studio yet. Make one on eqosys (Studio tab), then come back.");
}

signin.onclick = () => void eq.signIn();
signout.onclick = () => { eq.signOut(); void load(); };
if (!eq.canSignIn()) $<HTMLElement>("local").hidden = false;
const back = await eq.finishSignIn().catch(() => null);
if (back?.error) say(back.error, true);
await act(load)();
