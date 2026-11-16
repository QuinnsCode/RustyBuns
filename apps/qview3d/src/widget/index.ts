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
//   el.addImage(file, zone?) · el.addText({line, font, color}, zone?) · el.setText(words) · el.select(i) · el.raise() · el.lower() · el.place({u, v, scale, rotation}) · el.model = "hoodie" · el.zone = "back" · el.color = "#b91c1c" · el.view("side")
//   el.design (the settings) · el.load(design) · el.snapshot() -> {blob, design} · el.save() -> {id, url, design}
//   events: qview:ready, qview:change, qview:snapshot, qview:saved, qview:error (each with a detail)
//
// In a shop's own <form> it is a form field: <qview-3d name="design"> saves the design when the form is submitted and
// sends its id as `design` and its link as `design-url`, the way a hidden input would (a form-associated element).
import { createElement, BringToFront, Camera, CloudUpload, Eraser, ImagePlus, Rotate3d, RotateCw, Scaling, SendToBack, Type } from "lucide";
import { esc } from "@rustybuns/util";
import { getJson, readJson } from "@rustybuns/util/http";
import { DesignReply, FONTS, MAX_LAYERS, MODELS, Product, TOPS, Words, ZONES, type Design, type DesignReply as Saved, type Made, type Model, type Placement as Place, type PrintArea, type ZoneName } from "../api.ts";
import { sha256Of } from "./image.ts";
import { css } from "./style.ts";
import { problem, upload } from "./upload.ts";
import { FACES } from "./text.ts";
import type { Display, Layer, View, Viewer } from "./viewer.ts";

const DEFAULT_COLORS = ["#1f2937", "#f5f5f4", "#b91c1c", "#1d4ed8", "#166534", "#d97706", "#7c3aed", "#e7d7b9"];
const LABELS: Record<Made, string> = { cap: "Cap", beanie: "Beanie", bucket: "Bucket", tee: "Tee", sweater: "Sweater", hoodie: "Hoodie", tank: "Tank", racerback: "Racerback" };
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
  static observedAttributes = ["model", "color", "colors", "product", "controls", "display"];
  /** A field in its form: it submits the saved design's id under its `name`. */
  static formAssociated = true;
  private root = this.attachShadow({ mode: "open" });
  private internals = this.attachInternals();
  /** The last save, and the settings it saved (camera aside): the form sends it while nothing has changed since. */
  private saved: { id: string; url: string; key: string } | null = null;
  private form: HTMLFormElement | null = null;
  private viewer: Viewer | null = null;
  private ready: Promise<Viewer> | null = null;
  private colors = DEFAULT_COLORS;
  /** The product's own model (a sample's GLB key), when it has one. */
  private glb: string | null = null;
  private area: PrintArea | null = null;
  /** The product's switched-on zones and where a new picture lands, when the shop set them. */
  private print: readonly ZoneName[] | null = null;
  private startAt: Place | null = null;
  private firstColor() { return this.colors[0] ?? "#ffffff"; }
  private ui = this.build();

  get api() { return (this.getAttribute("api") ?? HOME).replace(/\/$/, ""); }
  get org() { return this.getAttribute("org"); }
  get model(): Model { return this.viewer?.model ?? asModel(this.getAttribute("model")); }
  /** One of the hats or tops. A shop's own model comes with its product (product="<sample id>"). */
  set model(m: Made) { this.setAttribute("model", m); }
  /** The print zone being worked on: where addImage() puts a picture and what place() moves. A hat has only "front". */
  get zone(): ZoneName { return this.viewer?.zone ?? "front"; }
  set zone(z: ZoneName) { this.viewer?.setZone(z); this.sync(); }
  /** A top on its form ("form"), or a sleeved one on a hanger ("hanger", a spike the default controls don't offer), settling under gravity when it loads or changes colour. */
  get display(): Display { return this.getAttribute("display") === "hanger" ? "hanger" : "form"; }
  set display(d: Display) { this.setAttribute("display", d); }
  get color() { return this.viewer?.color ?? this.getAttribute("color") ?? this.firstColor(); }
  set color(c: string) { this.setAttribute("color", c); }
  /** The current settings: model, colour, the picture's place and files, camera. What snapshot() and save() send. */
  get design(): Design | null { return this.viewer?.design() ?? null; }
  /** The form field's name: the design id goes in the form under it, and its link under `<name>-url`. */
  get name() { return this.getAttribute("name") ?? ""; }
  set name(n: string) { this.setAttribute("name", n); }
  /** The saved design's id, while it still matches what the shopper sees ("" before a save, or after a change). */
  get value() { return this.saved?.id ?? ""; }

  formAssociatedCallback(form: HTMLFormElement | null) {
    this.form?.removeEventListener("submit", this.submit, true);
    this.form = form;
    form?.addEventListener("submit", this.submit, true);
  }
  formResetCallback() { this.forget(); }

  /**
   * A submit first saves the design (pictures, snapshot, settings), then submits again with its id in the form. It
   * listens in the capture phase, so the page's own submit handlers only ever see the second submit, id and all. A
   * failed save stops the submit and says why (qview:error), as an invalid field would.
   */
  private submit = (e: SubmitEvent) => {
    if (!this.name || this.value) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const form = this.form, submitter = e.submitter instanceof HTMLElement ? e.submitter : null;
    void this.save().then(() => form?.requestSubmit(submitter as HTMLButtonElement | null), () => {});
  };

  private remember(id: string, url: string) {
    this.saved = { id, url, key: keyOf(this.viewer?.design()) };
    const data = new FormData();
    if (this.name) { data.set(this.name, id); data.set(`${this.name}-url`, url); }
    this.internals.setFormValue(data);
  }
  private forget() { this.saved = null; this.internals.setFormValue(null); }

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
    if (name === "display" && this.viewer.display !== this.display) { this.viewer.setDisplay(this.display); this.changed(); }
    if (name === "color" && this.viewer.color !== (this.getAttribute("color") ?? this.firstColor())) { this.viewer.setColor(this.getAttribute("color") ?? this.firstColor()); this.changed(); }
  }

  private boot(): Promise<Viewer> {
    this.ready ??= (async () => {
      const { Viewer } = await import("./viewer.ts");
      await this.loadProduct();
      const v = new Viewer(this.ui.gl);
      v.display = this.display;
      v.onChange = () => this.changed();
      v.startAt = this.startAt;
      if (this.glb) await v.setCustom(this.glbUrl(this.glb), this.area);
      else v.setModel(asModel(this.getAttribute("model")));
      v.setColor(this.getAttribute("color") ?? this.firstColor());
      v.setPrint(this.print);
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
    this.area = p.area ?? null;
    this.print = p.print ?? null;
    this.startAt = p.place ?? null;
    if (this.viewer) { this.viewer.startAt = this.startAt; this.viewer.setPrint(this.print); }
    if (this.glb && this.viewer) { await this.viewer.setCustom(this.glbUrl(this.glb), this.area); this.changed(); }
    if (p.model !== "custom" && !this.hasAttribute("model")) this.setAttribute("model", p.model);
    if (!this.hasAttribute("color") && p.colors[0]) this.setAttribute("color", p.colors[0]);
    this.drawSwatches();
  }

  private glbUrl(key: string) { return `${this.api}/r/${key.split("/").map(encodeURIComponent).join("/")}`; }

  // ---- the methods a page drives it with -------------------------------------------------------------------

  async addImage(file: Blob, zone?: ZoneName) {
    const v = await this.boot();
    try { await v.addImage(file, zone && (ZONES as readonly string[]).includes(zone) ? zone : undefined); } catch (e) { this.fail(e); throw e; }
    this.sync();
  }
  /** A line of text as a new layer, in `zone` or the one being worked on: `{line, font, color}` (font one of FONTS). */
  async addText(words: Words, zone?: ZoneName) {
    const v = await this.boot();
    try { await v.addText(Words(words), zone && (ZONES as readonly string[]).includes(zone) ? zone : undefined); } catch (e) { this.fail(e); throw e; }
    this.sync();
  }
  /** Change the text being worked on (its words, face or colour), where it sits. */
  async setText(words: Words) {
    const v = await this.boot();
    try { await v.setText(Words(words)); } catch (e) { this.fail(e); throw e; }
    this.sync();
  }
  /** Remove the layer being worked on (the zone's top one, unless another was picked). */
  removeImage() { this.viewer?.removeImage(); this.sync(); }
  /** Which layer is worked on, as its place in `design.layers` (-1 with none in this zone). */
  get selected(): number { const v = this.viewer, l = v?.layer; return v && l ? v.layers.indexOf(l) : -1; }
  /** Work on the layer at `i` in `design.layers`: what place(), raise(), lower() and removeImage() act on. */
  select(i: number) { const l = this.viewer?.layers[i]; if (l) this.viewer!.select(l); this.sync(); }
  /** Lay the layer being worked on over the next one in its zone. */
  raise() { this.viewer?.shift(1); this.sync(); }
  /** Lay it under the one below it. */
  lower() { this.viewer?.shift(-1); this.sync(); }
  place(p: { u?: number; v?: number; scale?: number; rotation?: number }) { this.viewer?.place(p); this.sync(); }
  view(v: View) { this.viewer?.view(v); }
  async load(d: Design) { await (await this.boot()).apply(d); this.sync(); }

  /** A PNG of the product as it looks now, with the settings that made it. Fires qview:snapshot. */
  async snapshot(scale = 2): Promise<{ blob: Blob; design: Design }> {
    const v = await this.boot();
    const blob = await v.snapshot(scale);
    const out = { blob, design: v.design() };
    this.emit("qview:snapshot", out);
    return out;
  }

  /** Upload the pictures (texture and original of each), a snapshot, and the settings to the org. Fires qview:saved. */
  async save(): Promise<Saved & { design: Design }> {
    const v = await this.boot();
    const org = this.org;
    if (!org) throw this.fail(new Error("save() needs an org attribute"));
    try {
      const base = `${this.api}/api/orgs/${encodeURIComponent(org)}`;
      for (const l of v.layers) {
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
      this.remember(saved.id, saved.url);
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
    // Where the picture goes, on a product with more than one place for it (a top's front, back and sleeve).
    const zones = h("div", { class: "models zones panel", part: "zones", role: "group", ariaLabel: "Print on", hidden: true });
    const turnView = iconButton(Rotate3d, "Turn the view", () => this.viewer?.nextView());
    const hint = h("button", { class: "hint panel", part: "hint", onclick: pick }, icon(ImagePlus), "Add your picture");

    const scale = h("input", { type: "range", min: "0.05", max: "1", step: "0.01", title: "Size", ariaLabel: "Picture size" });
    scale.oninput = () => this.place({ scale: Number(scale.value) });
    const turn = h("input", { type: "range", min: String(-Math.PI), max: String(Math.PI), step: "0.01", title: "Turn", ariaLabel: "Picture turn" });
    turn.oninput = () => this.place({ rotation: Number(turn.value) });
    const raise = iconButton(BringToFront, "Bring forward", () => this.raise());
    const lower = iconButton(SendToBack, "Send back", () => this.lower());
    const tune = h("div", { class: "tune", hidden: true, role: "group", ariaLabel: "Picture" },
      h("label", { class: "slider", part: "slider", title: "Size" }, icon(Scaling), scale),
      h("label", { class: "slider", part: "slider", title: "Turn" }, icon(RotateCw), turn),
      raise, lower,
      iconButton(Eraser, "Remove it", () => this.removeImage()));

    // The zone's layers, to pick one (a press on it in 3D does the same), and the words of a picked line of text.
    const stack = h("div", { class: "stack", role: "group", ariaLabel: "Layers here" });
    const words = h("input", { type: "text", maxLength: 60, placeholder: "Your text", ariaLabel: "Text" });
    const face = h("select", { ariaLabel: "Font", title: "Font" }, ...FONTS.map((f) => h("option", { value: f }, FACES[f].label)));
    const ink = h("input", { type: "color", ariaLabel: "Text colour", title: "Text colour" });
    let typing = 0;
    const retype = () => {
      clearTimeout(typing);
      typing = window.setTimeout(() => {
        const line = words.value.trim(), font = FONTS.find((f) => f === face.value);
        if (line && font) void this.setText({ line, font, color: ink.value }).catch(() => {});
      }, 180);
    };
    words.oninput = retype;
    face.onchange = retype;
    ink.oninput = retype;
    const text = h("div", { class: "text", part: "text", hidden: true, role: "group", ariaLabel: "Text" }, words, face, ink);
    const layers = h("div", { class: "layers panel", part: "layers", hidden: true }, stack, text);
    const addText = async () => {
      // Ink that reads on the product: white on a dark colour, near-black on a light one.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(this.color.slice(i, i + 2), 16) || 0);
      await this.addText({ line: "Your text", font: "sans", color: 0.299 * r! + 0.587 * g! + 0.114 * b! < 140 ? "#ffffff" : "#111111" });
      words.focus();
      words.select();
    };
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
    const addPic = iconButton(ImagePlus, "Add a picture", pick), addWords = iconButton(Type, "Add text", () => void addText().catch(() => {}));
    const toolbar = h("div", { class: "toolbar panel", part: "toolbar", role: "toolbar", ariaLabel: "Customise" },
      addPic, addWords, sepAdd, tune, sepTune, swatches, slot);
    const dock = h("div", { class: "dock" }, layers, toolbar);
    const corner = h("div", { class: "corner panel" }, turnView, shotBtn, saveBtn);
    const toast = h("div", { class: "toast panel", part: "toast", role: "status", ariaLive: "polite" });
    const keys = h("div", { class: "keys panel", part: "keys", hidden: true });
    keys.innerHTML = "<kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd> move &nbsp; <kbd>+</kbd><kbd>&minus;</kbd> size &nbsp; <kbd>[</kbd><kbd>]</kbd> turn &nbsp; <kbd>Shift</kbd>+arrows spin";
    gl.addEventListener("focusin", () => (keys.hidden = !this.viewer?.layer));
    gl.addEventListener("focusout", () => (keys.hidden = true));
    const stage = h("div", { class: "stage", part: "stage" }, gl, loading, models, zones, corner, hint, keys, dock, h("div", { class: "drop" }, "Drop your picture"), toast, file);
    this.root.append(style, stage);
    return { gl, loading, models, zones, hint, tune, scale, turn, raise, lower, layers, stack, text, words, face, ink, addPic, addWords, swatches, saveBtn, toast, sepAdd, sepTune, chrome: [models, zones, corner, hint, dock] as HTMLElement[] };
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
    // The row offers the product's own kind: a hat swaps for another hat, a top for another top.
    const kind = (m: string | undefined) => (TOPS as readonly (string | undefined)[]).includes(m);
    for (const b of this.ui.models.querySelectorAll<HTMLButtonElement>("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.model === this.model));
      b.hidden = kind(b.dataset.model) !== kind(this.model);
    }
    for (const b of this.ui.swatches.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.color?.toLowerCase() === this.color.toLowerCase()));
    const l = v?.layer;
    const zones = v?.zones ?? [];
    const zonesKey = `${this.model}:${zones.map((z) => z.name).join(",")}`;
    if (this.ui.zones.dataset.key !== zonesKey) {
      this.ui.zones.dataset.key = zonesKey;
      this.ui.zones.replaceChildren(...zones.map((z) => {
        const b = h("button", { part: "button zone", onclick: () => (this.zone = z.name) }, z.label);
        b.dataset.zone = z.name;
        return b;
      }));
    }
    for (const b of this.ui.zones.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.zone === v?.zone));
    this.ui.zones.hidden = none || zones.length < 2;
    this.ui.tune.hidden = !l;
    this.ui.hint.hidden = none || !v || !!v.layers.length;
    this.ui.models.hidden = none || this.model === "custom";
    this.ui.swatches.hidden = !this.colors.length;
    this.ui.sepAdd.hidden = this.ui.tune.hidden && this.ui.swatches.hidden;
    this.ui.sepTune.hidden = this.ui.tune.hidden || this.ui.swatches.hidden;
    this.ui.saveBtn.hidden = !this.org;
    if (l) { this.ui.scale.value = String(l.at.scale); this.ui.turn.value = String(l.at.rotation); }
    this.syncLayers(v, l ?? null, none);
  }

  /** The layer strip (shown once a zone holds two, or a line of text is picked), the order buttons and the text editor. */
  private syncLayers(v: Viewer | null, l: Layer | null, none: boolean) {
    const here = v?.here ?? [], full = !!v && v.layers.length >= MAX_LAYERS;
    this.ui.addPic.disabled = this.ui.addWords.disabled = full;
    const max = `Up to ${MAX_LAYERS} pictures and lines of text`;
    this.ui.addPic.title = full ? max : "Add a picture";
    this.ui.addWords.title = full ? max : "Add text";
    const i = l ? here.indexOf(l) : -1;
    this.ui.raise.disabled = i < 0 || i === here.length - 1;
    this.ui.lower.disabled = i <= 0;
    this.ui.raise.hidden = this.ui.lower.hidden = here.length < 2;
    // Top of the stack first, as a layers list reads; a chip is rebuilt only when the stack or its pictures change.
    const key = here.map((x) => `${this.chipId(x)}${x === l ? "*" : ""}`).join(",");
    if (this.ui.stack.dataset.key !== key) {
      this.ui.stack.dataset.key = key;
      this.ui.stack.replaceChildren(...[...here].reverse().map((x) => {
        const name = x.text ? `Text: ${x.text.line}` : `Picture ${here.indexOf(x) + 1}`;
        const b = h("button", { class: "chip", part: "button layer", title: name, ariaLabel: name, onclick: () => this.select(v!.layers.indexOf(x)) });
        b.setAttribute("aria-pressed", String(x === l));
        const c = h("canvas", { width: 56, height: 56 });
        const g = c.getContext("2d"), bm = x.picture.bitmap, k = Math.min(56 / bm.width, 56 / bm.height);
        g?.drawImage(bm, (56 - bm.width * k) / 2, (56 - bm.height * k) / 2, bm.width * k, bm.height * k);
        b.append(c);
        return b;
      }));
    }
    this.ui.stack.hidden = here.length < 2;
    this.ui.text.hidden = !l?.text;
    if (l?.text && this.root.activeElement !== this.ui.words) {
      this.ui.words.value = l.text.line;
      this.ui.face.value = l.text.font;
      this.ui.ink.value = l.text.color;
    }
    this.ui.layers.hidden = none || (this.ui.stack.hidden && this.ui.text.hidden);
  }

  /** A short id for a layer's current pixels, so the strip redraws a chip only when they change. */
  private chips = new WeakMap<object, number>();
  private chipN = 0;
  private chipId(l: Layer) {
    let n = this.chips.get(l.picture);
    if (n === undefined) this.chips.set(l.picture, (n = ++this.chipN));
    return n;
  }

  private changed() {
    if (this.saved && this.saved.key !== keyOf(this.viewer?.design())) this.forget();
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

/** A design's settings without the camera: turning the view doesn't change what gets printed. */
const keyOf = (d: Design | null | undefined) => (d ? JSON.stringify({ ...d, camera: undefined }) : "");
const asModel = (m: string | null): Made => MODELS.find((x) => x === m) ?? "cap";
const parseColors = (s: string | null) => {
  const list = (s ?? "").split(",").map((c) => c.trim()).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  return list.length ? list : null;
};

if (!customElements.get("qview-3d")) customElements.define("qview-3d", QView3D);

declare global {
  interface HTMLElementTagNameMap { "qview-3d": QView3D }
}
