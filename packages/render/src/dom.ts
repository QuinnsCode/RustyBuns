// A DOM just big enough for react-dom's client renderer, that writes down every
// change it is asked to make instead of drawing it. The page code (react-dom and
// the app) runs untouched; the op list is what an engine paints.

import { ROOT, type Op } from "./ops.ts";

type Listener = (e: RecEvent) => void;
interface Entry { fn: Listener; capture: boolean }

export class RecEvent {
  target: RecNode | null = null;
  currentTarget: RecNode | null = null;
  eventPhase = 0;
  defaultPrevented = false;
  isTrusted = true;
  timeStamp = performance.now();
  stopped = false;
  constructor(readonly type: string, readonly bubbles = true, readonly cancelable = true) {}
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; }
  getModifierState() { return false; }
}

export class RecNode {
  parentNode: RecNode | null = null;
  readonly childNodes: RecNode[] = [];
  private listeners = new Map<string, Entry[]>();
  readonly #doc: RecDocument | null;
  constructor(doc: RecDocument | null, readonly id: number, readonly nodeType: number, readonly nodeName: string) { this.#doc = doc; }
  /** Null on the document itself, as in a browser. */
  get ownerDocument(): RecDocument | null { return this.#doc; }
  /** The document that records this node's ops. */
  get rec(): RecDocument { if (!this.#doc) throw new Error("the document overrides rec"); return this.#doc; }

  get firstChild(): RecNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): RecNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): RecNode | null { return this.sibling(1); }
  get previousSibling(): RecNode | null { return this.sibling(-1); }
  get parentElement(): RecElement | null { return this.parentNode instanceof RecElement ? this.parentNode : null; }
  private sibling(step: number): RecNode | null {
    const kids = this.parentNode?.childNodes;
    return kids?.[kids.indexOf(this) + step] ?? null;
  }

  appendChild<T extends RecNode>(child: T): T { return this.insertBefore(child, null); }
  insertBefore<T extends RecNode>(child: T, before: RecNode | null): T {
    child.parentNode?.detach(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    this.rec.emit(["insert", this.id, child.id, before?.id ?? null]);
    return child;
  }
  removeChild<T extends RecNode>(child: T): T { this.detach(child); return child; }
  private detach(child: RecNode) {
    const at = this.childNodes.indexOf(child);
    if (at < 0) return;
    this.childNodes.splice(at, 1);
    child.parentNode = null;
    this.rec.emit(["remove", this.id, child.id]);
  }
  contains(other: RecNode | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(value: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (value !== "") this.appendChild(this.rec.createTextNode(value));
  }

  addEventListener(type: string, fn: Listener, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
    const list = this.listeners.get(type) ?? [];
    if (!list.some((e) => e.fn === fn && e.capture === capture)) list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((e) => e.fn !== fn || e.capture !== capture));
  }
  /** Capture down from the top, then bubble back up, the way a browser does. */
  dispatchEvent(e: RecEvent): boolean {
    e.target = this;
    const path: RecNode[] = [];
    for (let n: RecNode | null = this; n; n = n.parentNode) path.push(n);
    const run = (node: RecNode, capture: boolean, phase: number) => {
      e.currentTarget = node;
      e.eventPhase = phase;
      for (const l of node.listeners.get(e.type) ?? []) if (l.capture === capture) l.fn(e);
    };
    for (let i = path.length - 1; i > 0 && !e.stopped; i--) run(path[i]!, true, 1);
    if (!e.stopped) { run(this, true, 2); run(this, false, 2); }
    for (let i = 1; e.bubbles && i < path.length && !e.stopped; i++) run(path[i]!, false, 3);
    e.currentTarget = null;
    return !e.defaultPrevented;
  }
}

export class RecText extends RecNode {
  #value: string;
  constructor(doc: RecDocument, id: number, value: string) { super(doc, id, 3, "#text"); this.#value = value; }
  get nodeValue() { return this.#value; }
  set nodeValue(v: string) { this.#value = v; this.rec.emit(["setText", this.id, v]); }
  get data() { return this.#value; }
  set data(v: string) { this.nodeValue = v; }
  override get textContent() { return this.#value; }
  override set textContent(v: string) { this.nodeValue = v; }
}

const kebab = (prop: string) => prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** `el.style.color = "red"` and `el.style.setProperty("--x", "1")` both become a style op. */
type Style = Record<string, unknown> & { setProperty(p: string, v: string | null): void; removeProperty(p: string): void; getPropertyValue(p: string): string };
function styleFor(el: RecElement): Style {
  const values = new Map<string, string>();
  const set = (prop: string, v: string | null) => {
    const name = kebab(prop);
    if (v === null || v === "") values.delete(name); else values.set(name, v);
    el.rec.emit(["style", el.id, name, v === "" ? null : v]);
  };
  const api = { setProperty: set, removeProperty: (p: string) => set(p, null), getPropertyValue: (p: string) => values.get(kebab(p)) ?? "" };
  return new Proxy<Style>(api as Style, {
    get: (t, k) => typeof k === "string" && !(k in t) ? values.get(kebab(k)) ?? "" : Reflect.get(t, k),
    set: (_t, k, v) => { if (typeof k === "string") set(k, v == null ? null : String(v)); return true; },
  });
}

export class RecElement extends RecNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = styleFor(this);
  constructor(doc: RecDocument, id: number, tag: string, readonly namespaceURI = "http://www.w3.org/1999/xhtml") {
    super(doc, id, 1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
  }
  get localName() { return this.tagName.toLowerCase(); }
  setAttribute(name: string, value: unknown) {
    const v = String(value);
    this.attributes.set(name, v);
    this.rec.emit(["attr", this.id, name, v]);
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) { this.setAttribute(name, value); }
  removeAttribute(name: string) {
    if (this.attributes.delete(name)) this.rec.emit(["attr", this.id, name, null]);
  }
  removeAttributeNS(_ns: string | null, name: string) { this.removeAttribute(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(v: string) { this.setAttribute("class", v); }
  focus() { this.rec.activeElement = this; }
  blur() { if (this.rec.activeElement === this) this.rec.activeElement = this.rec.body; }
  click() { this.dispatchEvent(new RecEvent("click")); }
}

/** Form fields keep `value` and `checked` on the prototype, so react-dom's value tracker can wrap them as it does in a browser. */
export class RecInput extends RecElement {
  #value = "";
  #checked = false;
  get value() { return this.#value; }
  set value(v: string) { this.#value = String(v); this.rec.emit(["prop", this.id, "value", this.#value]); }
  get checked() { return this.#checked; }
  set checked(v: boolean) { this.#checked = !!v; this.rec.emit(["prop", this.id, "checked", this.#checked]); }
  get defaultValue() { return this.getAttribute("value") ?? ""; }
  set defaultValue(v: string) { this.setAttribute("value", v); }
  get defaultChecked() { return this.hasAttribute("checked"); }
  set defaultChecked(v: boolean) { if (v) this.setAttribute("checked", ""); else this.removeAttribute("checked"); }
  get type() { return this.getAttribute("type") ?? "text"; }
}

const FIELDS = new Set(["input", "textarea", "select"]);

export class RecDocument extends RecNode {
  private next = ROOT + 1;
  private ops: Op[] = [];
  private readonly byId = new Map<number, RecNode>();
  readonly documentElement: RecElement;
  readonly body: RecElement;
  activeElement: RecElement;
  defaultView: unknown = null;
  /** react-dom asks `"oninput" in document` before it trusts input events over its old-browser polyfill. */
  oninput = null;

  constructor() {
    // The document itself is never painted; its id sits below the root's.
    super(null, -1, 9, "#document");
    this.documentElement = this.mint((id) => new RecElement(this, id, "html"));
    this.body = this.mint((id) => new RecElement(this, id, "body"));
    this.activeElement = this.body;
    this.documentElement.parentNode = this;
    this.ops = [];
  }

  /** The container React renders into: id 0 for the engine. */
  createRoot(): RecElement {
    const root = new RecElement(this, ROOT, "div");
    this.byId.set(ROOT, root);
    root.parentNode = this.body;
    return root;
  }

  private mint<T extends RecNode>(make: (id: number) => T): T {
    const node = make(this.next++);
    this.byId.set(node.id, node);
    return node;
  }
  emit(op: Op) { this.ops.push(op); }
  /** Every op since the last take, oldest first. */
  take(): Op[] { const out = this.ops; this.ops = []; return out; }
  node(id: number) { return this.byId.get(id) ?? null; }

  createElement(tag: string): RecElement {
    const el = this.mint((id) => FIELDS.has(tag.toLowerCase()) ? new RecInput(this, id, tag) : new RecElement(this, id, tag));
    this.emit(["el", el.id, el.localName]);
    return el;
  }
  createElementNS(ns: string, tag: string): RecElement {
    const el = this.mint((id) => new RecElement(this, id, tag, ns));
    this.emit(["el", el.id, tag]);
    return el;
  }
  createTextNode(value: string): RecText {
    const t = this.mint((id) => new RecText(this, id, value));
    this.emit(["text", t.id, value]);
    return t;
  }
  getElementById(id: string) {
    for (const n of this.byId.values()) if (n instanceof RecElement && n.getAttribute("id") === id) return n;
    return null;
  }
  override get rec(): RecDocument { return this; }
  hasFocus() { return true; }
}
