// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The sandbox page (public/try.html): where someone lands from the link QView3D's owner sent (sandboxes.ts). The link's
// fragment holds the org and its admin key, so there is no sign-in. They see their product live, change it or add
// another, and take it to their own page whichever way suits: a line for their coding agent, the script tag, an
// iframe, or a script that writes products with the key. Their own product (not a hat or top) is a sample on /admin.html.
import { getJson } from "@rustybuns/util/http";
import { Shop } from "./api.ts";
import { act as acting, copyBox as copying, el, embedTag, productForm } from "./shop-ui.ts";
import { problem } from "./widget/upload.ts";
import "./widget/index.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // the page's own elements, by id
const status = $<HTMLDivElement>("status"), main = $<HTMLDivElement>("sandbox"), lost = $<HTMLElement>("lost");

const asked = new URLSearchParams(location.hash.slice(1));
const org = asked.get("org") ?? "", key = asked.get("key") ?? "";
const auth = { authorization: `Bearer ${key}` };

const say = (text: string, bad = false) => { status.textContent = text; status.classList.toggle("bad", bad); };
const act = (f: () => Promise<unknown>) => acting(say, f);
const copyBox = (title: string, text: string) => copying(title, text, say);
async function send(path: string, method: string, body: unknown): Promise<Response> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await problem(res));
  return res;
}

/** Every way onto a page, for one product: each a box to copy. */
function ways(origin: string, org: string, product: string, key: string): { title: string; text: string }[] {
  return [
    { title: "Ask your coding agent (Claude, Cursor, ...)", text: `Add the QView3D 3D customiser to my product page. Follow ${origin}/v1/embed.md?org=${org}&product=${product}` },
    { title: "Or paste the web component", text: embedTag(origin, org, product) },
    { title: "Or an iframe, for a site builder that strips scripts", text: `<iframe src="${origin}/v1/frame?org=${org}&product=${product}" title="Customise it in 3D"\n  style="width:100%;height:560px;border:0" allow="clipboard-write"></iframe>` },
    { title: "Or a script: write a product with this sandbox's key", text: `curl -X PUT ${origin}/api/orgs/${org}/products/${product} \\\n  -H "authorization: Bearer ${key}" -H "content-type: application/json" \\\n  -d '{"name":"My tee","model":"tee","colors":["#1f2937","#f4efe6"]}'` },
  ];
}

let picked = "";

async function load() {
  const shop = org && key ? await getJson(`/api/orgs/${encodeURIComponent(org)}`, Shop, { headers: auth }).catch(() => null) : null;
  lost.hidden = !!shop;
  main.hidden = !shop;
  if (!shop) return;
  if (!shop.products.some((p) => p.id === picked)) picked = shop.products[0]?.id ?? "";

  const until = shop.expires ? new Date(shop.expires).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "";
  $<HTMLElement>("until").textContent = until ? `Yours to try until ${until}. Any page may show it, and designs saved on it are kept.` : "Any page may show it.";

  const pick = el("select", { title: "Product to show" }, ...shop.products.map((p) => el("option", { value: p.id, textContent: p.product.name, selected: p.id === picked })));
  const widget = el("qview-3d");
  widget.setAttribute("org", shop.id);
  if (picked) widget.setAttribute("product", picked);
  const take = el("div");
  const drawWays = () => take.replaceChildren(...ways(location.origin, shop.id, picked || "my-product", key).map((w) => copyBox(w.title, w.text)));
  pick.onchange = () => { picked = pick.value; widget.setAttribute("product", picked); drawWays(); };
  drawWays();
  $<HTMLDivElement>("preview").replaceChildren(el("label", { class: "field" }, "Showing", pick), widget);
  $<HTMLDivElement>("take").replaceChildren(take);

  const editor = productForm(shop.id, send, say, load);
  const list = el("ul", { class: "products" }, ...shop.products.map((row) => {
    const change = el("button", { class: "copy", type: "button", textContent: "Change" });
    change.onclick = () => editor.edit(row);
    return el("li", {}, el("b", { textContent: row.product.name }), ` ${row.product.model}`, change);
  }));
  const own = el("a", { href: `/admin.html?org=${encodeURIComponent(shop.id)}#${new URLSearchParams({ key })}`, textContent: "Make a sample from photos" });
  $<HTMLDivElement>("products").replaceChildren(list, editor.form,
    shop.samples
      ? el("p", { class: "sub own" }, "Not a hat or a top? ", own, ` of your own product (${shop.samples} on this sandbox).`)
      : el("p", { class: "sub own", textContent: "Not a hat or a top? Ask whoever sent this link for a sample: a 3D model made from photos of your product." }));
}

await act(load)();
