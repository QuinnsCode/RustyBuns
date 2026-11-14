// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// <qview-3d>: the whole embed. A shop adds one script and one tag:
//
//   <script type="module" src="https://qview3d.example/v1/qview3d.js"></script>
//   <qview-3d org="acme" product="classic-cap"></qview-3d>
//
// This file is small and loads at once; three.js and the hats (viewer.ts) load only when the tag scrolls into view.
// The page stays in charge (inversion of control): it styles the defaults through --qv-* properties and ::part(),
// adds its own buttons in slot="controls", or turns them all off (controls="none") and drives the element through
// its methods and events instead:
//
//   el.addImage(file) · el.place({u, v, scale, rotation}) · el.model = "beanie" · el.color = "#b91c1c" · el.view("side")
//   el.design (the settings) · el.load(design) · el.snapshot() -> {blob, design} · el.save() -> {id, url, design}
//   events: qview:ready, qview:change, qview:snapshot, qview:saved, qview:error (each with a detail)
import { createElement, Camera, CloudUpload, Eraser, ImagePlus, Rotate3d, RotateCw, Scaling } from "lucide";
import { esc } from "@rustybuns/util";
import { getJson, readJson } from "@rustybuns/util/http";
import { DesignReply, MODELS, Product, type Design, type DesignReply as Saved, type Hat, type Model } from "../api.ts";
import { sha256Of } from "./image.ts";
import { css } from "./style.ts";
import { problem, upload } from "./upload.ts";
import type { View, Viewer } from "./viewer.ts";

const DEFAULT_COLORS = ["#1f2937", "#f5f5f4", "#b91c1c", "#1d4ed8", "#166534", "#d97706", "#7c3aed", "#e7d7b9"];
const LABELS: Record<Hat, string> = { cap: "Cap", beanie: "Beanie", bucket: "Bucket" };
/** Where the widget's own server is: the origin this script came from, unless the page says otherwise (api="..."). */
const HOME = new URL(import.meta.url).origin;

type Props<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, "part"> & { part?: string; class?: string };
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props<K>, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  const { part, class: cls, ...rest } = props ?? {};
  Object.assign(el, rest);
  if (part) el.setAttribute("part", part);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
};
const icon = (i: Parameters<typeof createElement>[0]) => createElement(i);
const iconButton = (i: Parameters<typeof createElement>[0], title: string, onclick: () => void) => {
  const b = h("button", { class: "icon", part: "button", title, onclick }, icon(i));
  b.setAttribute("aria-label", title);
  return b;
};

export class QView3D extends HTMLElement {
  static observedAttributes = ["model", "color", "colors", "product", "controls"];
  private root = this.attachShadow({ mode: "open" });
  private viewer: Viewer | null = null;
  private ready: Promise<Viewer> | null = null;
  private colors = DEFAULT_COLORS;
  /** The product's own model (a sample's GLB key), when it has one. */
  private glb: string | null = null;
  private firstColor() { return this.colors[0] ?? "#ffffff"; }
  private ui = this.build();

  get api() { return (this.getAttribute("api") ?? HOME).replace(/\/$/, ""); }
  get org() { return this.getAttribute("org"); }
  get model(): Model { return this.viewer?.model ?? asModel(this.getAttribute("model")); }
  /** One of the hats. A shop's own model comes with its product (product="<sample id>"). */
  set model(m: Hat) { this.setAttribute("model", m); }
  get color() { return this.viewer?.color ?? this.getAttribute("color") ?? this.firstColor(); }
  set color(c: string) { this.setAttribute("color", c); }
  /** The current settings: model, colour, the picture's place and files, camera. What snapshot() and save() send. */
  get design(): Design | null { return this.viewer?.design() ?? null; }

  connectedCallback() {
    // Load the 3D half when the tag is near the screen, not before: a product page with the widget below the fold
    // pays for one small script until the shopper scrolls to it.
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { io.disconnect(); void this.boot(); } }, { rootMargin: "200px" });
    io.observe(this);
    this.addEventListener("dragover", this.dragOver);
    this.addEventListener("dragleave", this.dragLeave);
    this.addEventListener("drop", this.drop);
  }

  disconnectedCallback() {
    this.viewer?.dispose();
    this.viewer = null;
    this.ready = null;
  }

  attributeChangedCallback(name: string) {
    if (name === "controls") this.ui.chrome.forEach((el) => (el.hidden = this.getAttribute("controls") === "none"));
    if (name === "colors") { this.colors = parseColors(this.getAttribute("colors")) ?? DEFAULT_COLORS; this.drawSwatches(); }
    if (name === "product" && this.ready) void this.loadProduct();
    if (!this.viewer) return;
    if (name === "model" && !this.glb && this.viewer.model !== asModel(this.getAttribute("model"))) { this.viewer.setModel(asModel(this.getAttribute("model"))); this.changed(); }
    if (name === "color" && this.viewer.color !== (this.getAttribute("color") ?? this.firstColor())) { this.viewer.setColor(this.getAttribute("color") ?? this.firstColor()); this.changed(); }
  }

  private boot(): Promise<Viewer> {
    this.ready ??= (async () => {
      const { Viewer } = await import("./viewer.ts");
      await this.loadProduct();
      const v = new Viewer(this.ui.gl);
      v.onChange = () => this.changed();
      if (this.glb) await v.setCustom(this.glbUrl(this.glb));
      else v.setModel(asModel(this.getAttribute("model")));
      v.setColor(this.getAttribute("color") ?? this.firstColor());
      this.viewer = v;
      this.ui.loading.remove();
      this.sync();
      this.emit("qview:ready", { design: v.design() });
      return v;
    })().catch((e) => { this.fail(e); throw e; });
    return this.ready;
  }

  /** A product from the org's folder sets the model and the colours on offer. */
  private async loadProduct() {
    const org = this.org, product = this.getAttribute("product");
    if (!org || !product) return;
    const p = await getJson(`${this.api}/api/orgs/${encodeURIComponent(org)}/products/${encodeURIComponent(product)}`, Product);
    if (!p) return this.fail(new Error(`No product "${product}" for ${org}`));
    this.colors = p.colors;
    this.glb = p.model === "custom" && p.glb ? p.glb : null;
    if (this.glb && this.viewer) { await this.viewer.setCustom(this.glbUrl(this.glb)); this.changed(); }
    if (p.model !== "custom" && !this.hasAttribute("model")) this.setAttribute("model", p.model);
    if (!this.hasAttribute("color") && p.colors[0]) this.setAttribute("color", p.colors[0]);
    this.drawSwatches();
  }

  private glbUrl(key: string) { return `${this.api}/r/${key.split("/").map(encodeURIComponent).join("/")}`; }

  // ---- the methods a page drives it with -------------------------------------------------------------------

  async addImage(file: Blob) {
    const v = await this.boot();
    try { await v.addImage(file); } catch (e) { this.fail(e); throw e; }
    this.sync();
  }
  removeImage() { this.viewer?.removeImage(); this.sync(); }
  place(p: { u?: number; v?: number; scale?: number; rotation?: number }) { this.viewer?.place(p); this.sync(); }
  view(v: View) { this.viewer?.view(v); }
  async load(d: Design) { (await this.boot()).apply(d); this.sync(); }

  /** A PNG of the product as it looks now, with the settings that made it. Fires qview:snapshot. */
  async snapshot(scale = 2): Promise<{ blob: Blob; design: Design }> {
    const v = await this.boot();
    const blob = await v.snapshot(scale);
    const out = { blob, design: v.design() };
    this.emit("qview:snapshot", out);
    return out;
  }

  /** Upload the picture (texture and original), a snapshot, and the settings to the org. Fires qview:saved. */
  async save(): Promise<Saved & { design: Design }> {
    const v = await this.boot();
    const org = this.org;
    if (!org) throw this.fail(new Error("save() needs an org attribute"));
    try {
      const base = `${this.api}/api/orgs/${encodeURIComponent(org)}`;
      const l = v.layer;
      if (l) {
        l.texture = await upload(base, "texture", l.picture.texture.blob, l.picture.texture.sha256);
        l.original = await upload(base, "original", l.picture.original.blob, l.picture.original.sha256);
      }
      const shot = await v.snapshot(2);
      const snapshot = await upload(base, "snapshot", shot, await sha256Of(shot));
      const design = { ...v.design(), snapshot, product: this.getAttribute("product") ?? undefined };
      const res = await fetch(`${base}/designs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(design) });
      const saved = res.ok ? await readJson(res, DesignReply) : null;
      if (!saved) throw new Error(await problem(res));
      const out = { ...saved, design };
      this.emit("qview:saved", out);
      return out;
    } catch (e) {
      throw this.fail(e);
    }
  }

  // ---- the default controls -------------------------------------------------------------------------------

  private build() {
    const style = h("style");
    style.textContent = css;
    const gl = h("div", { class: "gl" });
    const loading = h("div", { class: "loading" }, h("i"));
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
    file.onchange = () => { const f = file.files?.[0]; if (f) void this.addImage(f).catch(() => {}); file.value = ""; };
    const pick = () => file.click();

    const models = h("div", { class: "models panel", part: "models", role: "group", ariaLabel: "Product" }, ...MODELS.map((m) => {
      const b = h("button", { part: "button model", onclick: () => (this.model = m) }, LABELS[m]);
      b.dataset.model = m;
      return b;
    }));
    const turnView = iconButton(Rotate3d, "Turn the view", () => this.viewer?.nextView());
    const hint = h("button", { class: "hint panel", part: "hint", onclick: pick }, icon(ImagePlus), "Add your picture");

    const scale = h("input", { type: "range", min: "0.05", max: "1", step: "0.01", title: "Size", ariaLabel: "Picture size" });
    scale.oninput = () => this.place({ scale: Number(scale.value) });
    const turn = h("input", { type: "range", min: String(-Math.PI), max: String(Math.PI), step: "0.01", title: "Turn", ariaLabel: "Picture turn" });
    turn.oninput = () => this.place({ rotation: Number(turn.value) });
    const tune = h("div", { class: "tune", hidden: true, role: "group", ariaLabel: "Picture" },
      h("label", { class: "slider", part: "slider", title: "Size" }, icon(Scaling), scale),
      h("label", { class: "slider", part: "slider", title: "Turn" }, icon(RotateCw), turn),
      iconButton(Eraser, "Remove the picture", () => this.removeImage()));
    // Dividers show only with something on both sides: a shop's own model has no swatches.
    const sepAdd = h("span", { class: "sep" }), sepTune = h("span", { class: "sep" });

    const swatches = h("div", { class: "swatches", role: "group", ariaLabel: "Colour" });
    const saveBtn = h("button", { class: "primary", part: "button save", title: "Save this design" }, icon(CloudUpload), h("span", {}, "Save"));
    saveBtn.onclick = async () => {
      saveBtn.classList.add("busy");
      try {
        const s = await this.save();
        this.toast(`Saved. <a href="${esc(s.url)}" target="_blank" rel="noopener">Design ${esc(s.id.slice(0, 8))}</a>`);
      } catch { /* fail() already showed it */ } finally { saveBtn.classList.remove("busy"); }
    };
    const shotBtn = iconButton(Camera, "Download a snapshot", async () => {
      const { blob } = await this.snapshot(2);
      const a = h("a", { href: URL.createObjectURL(blob), download: `qview3d-${this.model}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const slot = h("slot");
    slot.name = "controls";
    const toolbar = h("div", { class: "toolbar panel", part: "toolbar", role: "toolbar", ariaLabel: "Customise" },
      iconButton(ImagePlus, "Add a picture", pick), sepAdd, tune, sepTune, swatches, slot);
    const corner = h("div", { class: "corner panel" }, turnView, shotBtn, saveBtn);
    const toast = h("div", { class: "toast panel", part: "toast", role: "status", ariaLive: "polite" });
    const keys = h("div", { class: "keys panel", part: "keys", hidden: true });
    keys.innerHTML = "<kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd> move &nbsp; <kbd>+</kbd><kbd>&minus;</kbd> size &nbsp; <kbd>[</kbd><kbd>]</kbd> turn &nbsp; <kbd>Shift</kbd>+arrows spin";
    gl.addEventListener("focusin", () => (keys.hidden = !this.viewer?.layer));
    gl.addEventListener("focusout", () => (keys.hidden = true));
    const stage = h("div", { class: "stage", part: "stage" }, gl, loading, models, corner, hint, keys, toolbar, h("div", { class: "drop" }, "Drop your picture"), toast, file);
    this.root.append(style, stage);
    return { gl, loading, models, hint, tune, scale, turn, swatches, saveBtn, toast, sepAdd, sepTune, chrome: [models, corner, hint, toolbar] as HTMLElement[] };
  }

  private drawSwatches() {
    this.ui.swatches.replaceChildren(...this.colors.map((c) => {
      const b = h("button", { class: "swatch", part: "swatch", title: c, ariaLabel: `Colour ${c}`, onclick: () => (this.color = c) });
      b.style.setProperty("--c", c);
      b.dataset.color = c;
      return b;
    }));
    this.sync();
  }

  /** Bring the controls in line with the viewer. */
  private sync() {
    const v = this.viewer, none = this.getAttribute("controls") === "none";
    for (const b of this.ui.models.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.model === this.model));
    for (const b of this.ui.swatches.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.color?.toLowerCase() === this.color.toLowerCase()));
    const l = v?.layer;
    this.ui.tune.hidden = !l;
    this.ui.hint.hidden = none || !v || !!l;
    this.ui.models.hidden = none || this.model === "custom";
    this.ui.swatches.hidden = !this.colors.length;
    this.ui.sepAdd.hidden = this.ui.tune.hidden && this.ui.swatches.hidden;
    this.ui.sepTune.hidden = this.ui.tune.hidden || this.ui.swatches.hidden;
    this.ui.saveBtn.hidden = !this.org;
    if (l) { this.ui.scale.value = String(l.at.scale); this.ui.turn.value = String(l.at.rotation); }
  }

  private changed() {
    this.sync();
    this.emit("qview:change", { design: this.viewer!.design() });
  }

  private dragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); this.toggleAttribute("dragover", true); } };
  private dragLeave = () => this.removeAttribute("dragover");
  private drop = (e: DragEvent) => {
    e.preventDefault();
    this.removeAttribute("dragover");
    const f = e.dataTransfer?.files[0];
    if (f) void this.addImage(f).catch(() => {});
  };

  private toast(html: string, ms = 4000) {
    const t = this.ui.toast;
    t.innerHTML = html;
    t.classList.add("on");
    clearTimeout(Number(t.dataset.timer));
    t.dataset.timer = String(setTimeout(() => t.classList.remove("on"), ms));
  }

  private fail(e: unknown): Error {
    const err = e instanceof Error ? e : new Error(String(e));
    this.toast(esc(err.message));
    this.emit("qview:error", { error: err });
    return err;
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

const asModel = (m: string | null): Hat => MODELS.find((x) => x === m) ?? "cap";
const parseColors = (s: string | null) => {
  const list = (s ?? "").split(",").map((c) => c.trim()).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  return list.length ? list : null;
};

if (!customElements.get("qview-3d")) customElements.define("qview-3d", QView3D);

declare global {
  interface HTMLElementTagNameMap { "qview-3d": QView3D }
}
