// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The shops page (public/orgs.html): sign in with eqosys and see your studios. A studio's owner or admin sets up its
// products, copies the embed tag and makes a key for a script; QView3D's owner (the house studio) makes the org for
// a studio from its id, which the friend copies from this same page, or hands someone a sandbox link (sandboxes.ts).
import { eqosys } from "@rustybuns/util/eqosys";
import { getJson } from "@rustybuns/util/http";
import { APP, Delivery, EQOSYS, HookReply, Hooks, KeyReply, Mine, SandboxReply, ShopifyState, slug, type HookRequest, type SandboxRequest, type ShopStart, type ShopifyLink, type ShopifyPicks, type Sites } from "./api.ts";
import { act as acting, copyBox as copying, el, embedTag, field, productForm as editor } from "./shop-ui.ts";
import { problem } from "./widget/upload.ts";
import "./menu.ts";

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
 * A sandbox to keep, from /try.html's Keep this as my shop (#keep=<org>&key=<key>). Held in sessionStorage too, since
 * signing in goes to eqosys and back without the fragment; dropped once kept.
 */
const KEEP = "qview3d-keep";
const keeping = ((): { org: string; key: string } | null => {
  const q = new URLSearchParams(location.hash.slice(1));
  const org = q.get("keep"), key = q.get("key");
  try {
    if (org && key) { sessionStorage.setItem(KEEP, JSON.stringify({ org, key })); history.replaceState(null, "", location.pathname); return { org, key }; }
    const v: unknown = JSON.parse(sessionStorage.getItem(KEEP) ?? "null");
    return v && typeof v === "object" && "org" in v && "key" in v && typeof v.org === "string" && typeof v.key === "string" ? { org: v.org, key: v.key } : null;
  } catch { return org && key ? { org, key } : null; }
})();

/**
 * A Shopify store to connect, from the app's install (#shopify=<claim>, shopify.ts). Held in sessionStorage too, for
 * the same trip to eqosys and back; dropped once connected.
 */
const STORE = "qview3d-shopify";
let claim = ((): string | null => {
  const c = new URLSearchParams(location.hash.slice(1)).get("shopify");
  try {
    if (c) { sessionStorage.setItem(STORE, c); history.replaceState(null, "", location.pathname); return c; }
    return sessionStorage.getItem(STORE);
  } catch { return c; }
})();

/** The shop's Shopify store: connect the one just installed, then pick which of its products show the customiser. */
function shopifyBlock(o: NonNullable<Mine["shops"][number]["org"]>, reload: () => Promise<void>) {
  const box = el("div", { class: "hooks" });
  if (claim) {
    const go = el("button", { class: "go", type: "button", textContent: o.shopify ? "Connect the new store here instead" : "Connect my Shopify store to this shop" });
    go.onclick = act(async () => {
      const got = ShopifyState(await (await send(`/api/orgs/${o.id}/shopify`, "POST", { claim: claim! } satisfies ShopifyLink)).json());
      claim = null;
      try { sessionStorage.removeItem(STORE); } catch { /* nothing kept */ }
      say(`${got.shop} is connected. Pick its products below, then add the QView3D block to your product page in the theme editor.`);
      await reload();
    });
    box.append(el("p", { class: "sub", textContent: "You installed QView3D on a Shopify store. One click joins it to this shop." }), go);
  }
  if (!o.shopify) {
    if (!claim) box.append(el("p", { class: "sub", textContent: "No store yet. Install QView3D from Shopify and you land back here to connect it." }));
    return box;
  }
  const list = el("div");
  box.append(el("p", { class: "sub", textContent: `Connected: ${o.shopify}. Orders with a design get their print files' links in the order's note.` }), list);
  void act(async () => {
    const t = token();
    const got = t ? await getJson(`/api/orgs/${o.id}/shopify`, ShopifyState, { headers: { authorization: `Bearer ${t}` } }) : null;
    if (!got) throw new Error("Couldn't read the store's products. Open QView3D from your Shopify admin again.");
    const rows = got.products.map((p) => {
      const pick = el("select", {}, el("option", { value: "", textContent: "No customiser" }), ...o.products.map((q) => el("option", { value: q.id, textContent: q.product.name, selected: q.id === p.product })));
      return { handle: p.handle, pick, row: field(p.title, pick) };
    });
    const save = el("button", { class: "go", type: "submit", textContent: "Save the picks" });
    const form = el("form", {}, ...rows.map((r) => r.row), save);
    form.onsubmit = act(async () => {
      const picks = rows.filter((r) => r.pick.value).map((r) => ({ handle: r.handle, product: r.pick.value }));
      await send(`/api/orgs/${o.id}/shopify/products`, "PUT", { picks } satisfies ShopifyPicks);
      say(`Saved: ${picks.length} of the store's products show the customiser.`);
    });
    list.replaceChildren(rows.length ? form : el("p", { class: "sub", textContent: "The store has no products yet." }));
  })();
  return box;
}

/** A studio with no shop: its owner or admin starts one here, or keeps the sandbox they came from. */
function startCard(shop: Mine["shops"][number], body: HTMLElement, reload: () => Promise<void>) {
  if (shop.role === "maker") {
    body.append(el("p", { textContent: "No shop yet. Your studio's owner or an admin can start one here." }));
    return;
  }
  const start = (req: ShopStart) => act(async () => {
    await send("/api/mine/shops", "POST", req);
    try { sessionStorage.removeItem(KEEP); } catch { /* nothing kept */ }
    say("Your shop is ready. Add your site below, then paste the tag into your product page.");
    await reload();
  });
  if (keeping) {
    const keep = el("button", { type: "button", textContent: `Keep ${keeping.org} as this shop` });
    keep.onclick = start({ studio: shop.studio, sandbox: keeping });
    body.append(el("p", { textContent: "Your sandbox's products and sites move here, and it no longer ends." }), keep);
    return;
  }
  const id = el("input", { value: slug(shop.name), placeholder: "fern-hats", pattern: "[a-z0-9][a-z0-9\\-]{0,62}", required: true });
  const go = el("button", { type: "button", textContent: "Start my shop" });
  go.onclick = start({ studio: shop.studio, org: id.value });
  id.oninput = () => { go.onclick = start({ studio: shop.studio, org: id.value }); };
  body.append(el("p", { textContent: "No shop yet. Start one: it goes in your embed tag, and it starts with a tee to try." }), field("Shop id", id), go);
}

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
    startCard(shop, body, reload);
    return card;
  }
  const sites = o.origins.length ? o.origins.join(", ") : "none yet, so no page shows it until you add yours below";
  body.append(el("p", { class: "sub", textContent: `Org ${o.id}. Sites: ${sites}. Samples: ${o.samples}. Script keys: ${o.keys}.` }));
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
  body.append(el("h2", { textContent: "Shopify" }), shopifyBlock(o, reload));
  body.append(el("h2", { textContent: "Webhooks" }), hooksBlock(o.id));
  return card;
}

/** The shop's webhooks: add a URL (its secret shown once), Send test, Remove, and the last 20 deliveries. */
function hooksBlock(org: string) {
  const box = el("div", { class: "hooks" });
  const draw = act(async () => {
    const t = token();
    const got = t ? await getJson(`/api/orgs/${org}/hooks`, Hooks, { headers: { authorization: `Bearer ${t}` } }) : null;
    if (!got) throw new Error("Couldn't read the webhooks. Sign in again.");
    const url = el("input", { type: "url", placeholder: "https://yourshop.com/qview3d-hook", required: true });
    const add = el("form", {}, field("Send events to", url), el("button", { class: "go", type: "submit", textContent: "Add the webhook" }));
    add.onsubmit = act(async () => {
      const made = HookReply(await (await send(`/api/orgs/${org}/hooks`, "POST", { url: url.value.trim() } satisfies HookRequest)).json());
      await draw();
      box.append(copyBox("Signing secret, shown once: your receiver checks QView3D-Signature with it", made.secret));
    });
    const list = el("ul", { class: "products" }, ...got.hooks.map((h) => {
      const test = el("button", { class: "copy", type: "button", textContent: "Send test" });
      test.onclick = act(async () => { const d = Delivery(await (await send(`/api/orgs/${org}/hooks/${h.id}/test`, "POST", {})).json()); say(d.status === "ok" ? `Test sent: it answered ${d.code}.` : `Test failed: ${d.error ?? "no answer"}.`, d.status !== "ok"); await draw(); });
      const remove = el("button", { class: "copy", type: "button", textContent: "Remove" });
      remove.onclick = act(async () => { await send(`/api/orgs/${org}/hooks/${h.id}`, "DELETE", {}); say("Removed the webhook."); await draw(); });
      return el("li", {}, el("b", { textContent: h.url }), ` ${h.events.join(", ")}`, test, remove);
    }));
    const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const log = el("ul", { class: "log" }, ...got.deliveries.map((d) =>
      el("li", { textContent: `${when(d.at)}  ${d.event}  ${d.status}${d.code ? ` (${d.code})` : ""}${d.error && d.status !== "ok" ? `: ${d.error}` : ""}${d.next ? `, next try ${when(d.next)}` : ""}` })));
    box.replaceChildren(
      el("p", { class: "sub", textContent: "We POST design.saved and order.ready to your URL, signed. Stores send orders to POST /api/orgs/" + org + "/orders with a script key. How: /v1/embed.md." }),
      got.hooks.length ? list : el("p", { class: "sub", textContent: "No webhooks yet." }),
      ...(got.hooks.length < 5 ? [add] : []),
      ...(got.deliveries.length ? [el("p", { class: "sub", textContent: "Last deliveries" }), log] : []));
  });
  void draw();
  return box;
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
