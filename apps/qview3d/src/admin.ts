// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The admin page (public/admin.html): a shop makes a sample of its own product. Photos (or a short video, from
// which four frames are taken here in the browser) are cut to 1600 px JPEGs, uploaded privately with the admin
// key, and sent to make a model. The page polls until it's ready, then shows it in the widget with its embed tag.
// Below that, print files: a saved design's original laid out per zone at print resolution, for the fulfiller.
// Above the form: how many samples are left, and packs to buy more (billing.ts).
import { getJson, readJson } from "@rustybuns/util/http";
import { Billing, CheckoutReply, PrintPlan, Sample } from "./api.ts";
import { drawSheet, withDpi } from "./print-sheet.ts";
import { sha256Of } from "./widget/image.ts";
import { problem, upload } from "./widget/upload.ts";
import "./widget/index.ts";

const PHOTO_MAX = 1600;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T; // the page's own elements, by id

const org = $<HTMLInputElement>("org"), key = $<HTMLInputElement>("key"), name = $<HTMLInputElement>("name");
const drop = $<HTMLLabelElement>("drop"), files = $<HTMLInputElement>("files"), thumbs = $<HTMLDivElement>("thumbs");
const go = $<HTMLButtonElement>("go"), status = $<HTMLDivElement>("status"), bar = $<HTMLDivElement>("bar");
const clock = $<HTMLSpanElement>("clock"), result = $<HTMLElement>("result"), note = $<HTMLParagraphElement>("note");

const asked = new URLSearchParams(location.search);
org.value ||= asked.get("org") ?? "";
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  org.value ||= "demo";
  key.value ||= "demo-admin-key";
  note.hidden = false;
}

let photos: Blob[] = [];

const api = () => `${location.origin}/api/orgs/${encodeURIComponent(org.value.trim())}`;
const auth = () => ({ authorization: `Bearer ${key.value.trim()}` });
const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** Samples left and the packs on offer, for the org and key in the boxes. Hidden until both are right. */
async function billing() {
  const bill = $<HTMLDivElement>("bill");
  const b = org.value.trim() && key.value.trim() ? await getJson(`${api()}/billing`, Billing, { headers: auth() }).catch(() => null) : null;
  bill.hidden = !b;
  if (!b) return;
  const left = Math.max(0, b.allowance - b.used);
  $<HTMLElement>("left").textContent = `${left} ${left === 1 ? "sample" : "samples"} left`;
  $<HTMLElement>("used").textContent = `${b.used} of ${b.allowance} used`;
  $<HTMLDivElement>("off").hidden = !!b.provider;
  $<HTMLDivElement>("packs").replaceChildren(...(b.provider ? b.packs : []).map((p) => {
    const btn = Object.assign(document.createElement("button"), { className: "pack", title: `Buy ${p.samples} samples for ${dollars(p.cents)}` });
    btn.append(Object.assign(document.createElement("b"), { textContent: `+${p.samples}` }), Object.assign(document.createElement("span"), { textContent: dollars(p.cents) }));
    btn.onclick = () => void buy(p.id, btn);
    return btn;
  }));
  $<HTMLDetailsElement>("receipts").hidden = !b.receipts.length;
  $<HTMLUListElement>("rlist").replaceChildren(...b.receipts.map((r) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { textContent: `${new Date(r.at).toLocaleDateString()}: ${r.samples} samples${r.provider === "test" ? " (test)" : ""}` }), Object.assign(document.createElement("span"), { textContent: dollars(r.cents) }));
    return li;
  }));
}

/** Buy a pack: off to the payment page, or (the test provider) paid already. */
async function buy(pack: string, btn: HTMLButtonElement) {
  btn.disabled = true;
  try {
    const res = await fetch(`${api()}/checkout`, { method: "POST", headers: { "content-type": "application/json", ...auth() }, body: JSON.stringify({ pack }) });
    if (!res.ok) throw new Error(await problem(res));
    const c = await readJson(res, CheckoutReply);
    if (!c) throw new Error("the server sent something this page can't read");
    if (c.receipt) { say("Paid: the samples are yours."); await billing(); } else location.assign(c.url);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true);
  } finally {
    btn.disabled = false;
  }
}

org.onchange = key.onchange = () => void billing();
if (asked.get("paid")) say("Paid: thank you. Your samples are added as soon as the payment clears.");
void billing();

/** A picture as a JPEG of at most PHOTO_MAX px on its long side: what Meshy needs, a fraction of a phone photo. */
async function shrink(src: CanvasImageSource & { width: number; height: number }): Promise<Blob> {
  const k = Math.min(1, PHOTO_MAX / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
  if (!b) throw new Error("could not read that picture");
  return b;
}

/** Four frames spread across a video, taken here: the video itself never leaves the browser. */
async function frames(file: File): Promise<Blob[]> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.src = URL.createObjectURL(file);
  await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error("this browser can't play that video")); });
  const out: Blob[] = [];
  for (const t of [0.12, 0.37, 0.62, 0.87]) {
    v.currentTime = v.duration * t;
    await new Promise((ok) => (v.onseeked = ok));
    out.push(await shrink(Object.assign(v, { width: v.videoWidth, height: v.videoHeight })));
  }
  URL.revokeObjectURL(v.src);
  return out;
}

async function take(list: FileList | File[]) {
  const all = [...list];
  const video = all.find((f) => f.type.startsWith("video/"));
  try {
    photos = video ? await frames(video) : await Promise.all(all.filter((f) => f.type.startsWith("image/")).slice(0, 4).map(async (f) => shrink(await createImageBitmap(f))));
  } catch (e) {
    return say(e instanceof Error ? e.message : String(e), true);
  }
  thumbs.replaceChildren(...photos.map((b) => Object.assign(document.createElement("img"), { src: URL.createObjectURL(b), alt: "" })));
  drop.classList.toggle("has", photos.length > 0);
  go.disabled = !photos.length;
  say(photos.length ? `${photos.length} ${photos.length === 1 ? "picture" : "pictures"} ready${video ? ", taken from the video" : ""}. More angles make a better model.` : "No pictures in that.");
}

function say(text: string, bad = false) {
  status.textContent = text;
  status.classList.toggle("bad", bad);
}

files.onchange = () => { if (files.files) void take(files.files); };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer?.files) void take(e.dataTransfer.files); };

let timer = 0;
function tick(from: number) {
  clearInterval(timer);
  const show = () => {
    const s = Math.floor((Date.now() - from) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  show();
  timer = window.setInterval(show, 1000);
}

go.onclick = async () => {
  const base = api();
  const auth = { authorization: `Bearer ${key.value.trim()}` };
  go.disabled = true;
  result.hidden = true;
  bar.style.width = "0%";
  try {
    say("Uploading the pictures...");
    const keys: string[] = [];
    for (const p of photos) keys.push(await upload(base, "photo", p, await sha256Of(p), auth));
    say("Asking for the model...");
    const res = await fetch(`${base}/models`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ name: name.value.trim() || "My product", photos: keys }) });
    if (!res.ok) throw new Error(await problem(res));
    const first = await readJson(res, Sample);
    if (!first) throw new Error("the server sent something this page can't read");
    let s = first;
    tick(s.created);
    while (s.status === "generating") {
      say(`Making the model: ${Math.round(s.progress)}%. This takes a minute or two.`);
      bar.style.width = `${Math.max(4, s.progress)}%`;
      await new Promise((r) => setTimeout(r, 3000));
      const next = await getJson(`${base}/models/${s.id}`, Sample, { headers: auth });
      if (next) s = next;
    }
    clearInterval(timer);
    if (s.status === "failed") throw new Error(s.error ?? "the model didn't come out");
    bar.style.width = "100%";
    say("Ready. Put a picture on it below, then paste the tag into your product page.");
    show(org.value.trim(), s.product ?? s.id);
  } catch (e) {
    clearInterval(timer);
    say(e instanceof Error ? e.message : String(e), true);
  } finally {
    go.disabled = !photos.length;
    void billing();
  }
};

function show(o: string, product: string) {
  const tag = `<script type="module" src="${location.origin}/v1/qview3d.js"></script>\n<qview-3d org="${o}" product="${product}"></qview-3d>`;
  const el = document.createElement("qview-3d");
  el.setAttribute("org", o);
  el.setAttribute("product", product);
  $<HTMLDivElement>("preview").replaceChildren(el);
  $<HTMLElement>("tag").textContent = tag;
  $<HTMLButtonElement>("copy").onclick = () => void navigator.clipboard.writeText(tag).then(() => say("Copied the tag."));
  result.hidden = false;
  $<HTMLDivElement>("empty").hidden = true;
}

const design = $<HTMLInputElement>("design"), printGo = $<HTMLButtonElement>("printGo");
const printStatus = $<HTMLDivElement>("printStatus"), sheets = $<HTMLDivElement>("sheets");

function sayPrint(text: string, bad = false) {
  printStatus.textContent = text;
  printStatus.classList.toggle("bad", bad);
}

/** A saved design's print files: ask for the plan, fetch each original with the admin key, draw it, offer the PNG. */
async function printFiles() {
  const id = design.value.trim().split("/").pop()?.replace(/\.json$/, "") ?? "";
  const base = `${location.origin}/api/orgs/${encodeURIComponent(org.value.trim())}`;
  const auth = { authorization: `Bearer ${key.value.trim()}` };
  printGo.disabled = true;
  sheets.replaceChildren();
  try {
    sayPrint("Reading the design...");
    const res = await fetch(`${base}/designs/${encodeURIComponent(id)}/print`, { headers: auth });
    if (!res.ok) throw new Error(await problem(res));
    const plan = await readJson(res, PrintPlan);
    if (!plan) throw new Error("the server sent something this page can't read");
    for (const s of plan.sheets) {
      sayPrint(`Drawing the ${s.zone} at ${s.px.w} x ${s.px.h} px...`);
      const got = await fetch(s.original, { headers: auth });
      if (!got.ok) throw new Error(`${s.zone}: ${await problem(got)}`);
      const image = await createImageBitmap(await got.blob());
      const canvas = new OffscreenCanvas(s.px.w, s.px.h);
      drawSheet(canvas.getContext("2d")!, s, image, image.width / image.height);
      image.close();
      const png = withDpi(new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()), plan.dpi);
      const href = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
      const card = document.createElement("figure");
      card.className = "sheet";
      card.style.margin = "0";
      const name = `design-${plan.design}-${s.zone}.png`;
      const link = Object.assign(document.createElement("a"), { href, download: name, textContent: "Download", className: "copy" });
      const label = document.createElement("span");
      label.append(Object.assign(document.createElement("b"), { textContent: s.zone }), ` ${s.cm.w} x ${s.cm.h} cm`);
      const row = document.createElement("div");
      row.append(label, link);
      card.append(Object.assign(document.createElement("img"), { src: href, alt: `${s.zone} print file` }), row);
      sheets.append(card);
    }
    const left = plan.skipped.map((s) => `${s.zone}: ${s.why}`).join("; ");
    if (!plan.sheets.length) throw new Error(left || "this design has no pictures to print");
    sayPrint(`${plan.sheets.length} print ${plan.sheets.length === 1 ? "file" : "files"} at ${plan.dpi} dpi.${left ? ` Not printable: ${left}.` : ""}`);
  } catch (e) {
    sayPrint(e instanceof Error ? e.message : String(e), true);
  } finally {
    printGo.disabled = false;
  }
}
printGo.onclick = () => void printFiles();
design.onkeydown = (e) => { if (e.key === "Enter") void printFiles(); };
