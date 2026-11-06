// Turns a real DOM's changes into ops. A MutationObserver says which parents,
// attributes and texts changed; each frame re-reads them as they are now, so the
// ops never replay a state the page has already left. Form values are not
// mutations (React sets el.value), so fields are compared frame to frame.

import { ROOT, type Op } from "./ops.ts";

// The slice of the DOM this reads; happy-dom's nodes and a browser's both fit.
interface DomNode { nodeType: number; childNodes: ArrayLike<DomNode>; parentNode: DomNode | null; data?: string }
interface DomElement extends DomNode { localName: string; attributes: ArrayLike<{ name: string; value: string }>; getAttribute(n: string): string | null }
interface DomField extends DomElement { value: string; checked: boolean }
interface Record_ { type: string; target: DomNode; attributeName: string | null }
interface Observer { observe(n: DomNode, o: object): void; takeRecords(): Record_[]; disconnect(): void }
type ObserverClass = new (cb: (records: Record_[]) => void) => Observer;

const ELEMENT = 1, TEXT = 3, COMMENT = 8, DOCUMENT = 9;
const isElement = (n: DomNode): n is DomElement => n.nodeType === ELEMENT;
const isField = (n: DomElement): n is DomField => n.localName === "input" || n.localName === "textarea" || n.localName === "select";
const textOf = (n: DomNode) => n.data ?? "";

export class Recorder {
  private ids = new WeakMap<DomNode, number>();
  private next = ROOT + 1;
  private kids = new Map<number, number[]>();
  private fields = new Map<number, { el: DomField; value: string; checked: boolean }>();
  private ops: Op[] = [];
  // Spike: ids stay mapped after a node leaves the page; the engine drops detached subtrees at frame end.
  private byId = new Map<number, DomNode>();
  private observer: Observer;
  private pending: Record_[] = [];

  constructor(doc: DomNode, MutationObserver: ObserverClass) {
    this.ids.set(doc, ROOT);
    this.byId.set(ROOT, doc);
    // Records the observer already delivered wait here; takeRecords() has only the ones it hasn't.
    this.observer = new MutationObserver((records) => { this.pending.push(...records); });
    this.observer.observe(doc, { childList: true, subtree: true, attributes: true, characterData: true });
    this.sync(doc);
  }

  /** The node behind an id the engine sent back. */
  node(id: number): DomNode | null { return this.byId.get(id) ?? null; }

  /** Everything that changed since the last take, as ops. */
  take(): Op[] {
    const parents = new Set<DomNode>(), attrs = new Map<DomElement, Set<string>>(), texts = new Set<DomNode>();
    const records = [...this.pending, ...this.observer.takeRecords()];
    this.pending = [];
    for (const r of records) {
      if (r.type === "childList") parents.add(r.target);
      else if (r.type === "characterData") texts.add(r.target);
      else if (r.attributeName && isElement(r.target)) {
        const set = attrs.get(r.target) ?? new Set();
        attrs.set(r.target, set.add(r.attributeName));
      }
    }
    for (const p of parents) if (this.ids.has(p)) this.sync(p);
    for (const [el, names] of attrs) {
      const id = this.ids.get(el);
      if (id !== undefined) for (const n of names) this.ops.push(["attr", id, n, el.getAttribute(n)]);
    }
    for (const t of texts) {
      const id = this.ids.get(t);
      if (id !== undefined) this.ops.push(["setText", id, textOf(t)]);
    }
    for (const [id, f] of this.fields) {
      if (f.el.value !== f.value) this.ops.push(["prop", id, "value", (f.value = f.el.value)]);
      if (f.el.checked !== f.checked) this.ops.push(["prop", id, "checked", (f.checked = f.el.checked)]);
    }
    const out = this.ops;
    this.ops = [];
    return out;
  }

  close() { this.observer.disconnect(); }

  /** The node's id, describing it (and everything under it) the first time it is seen. */
  private describe(n: DomNode): number {
    const known = this.ids.get(n);
    if (known !== undefined) return known;
    const id = this.next++;
    this.ids.set(n, id);
    this.byId.set(id, n);
    if (n.nodeType === TEXT) this.ops.push(["text", id, textOf(n)]);
    else if (n.nodeType === COMMENT || !isElement(n)) this.ops.push(["comment", id]);
    else {
      this.ops.push(["el", id, n.localName]);
      for (const a of Array.from(n.attributes)) this.ops.push(["attr", id, a.name, a.value]);
      if (isField(n)) {
        this.fields.set(id, { el: n, value: n.value, checked: n.checked });
        if (n.value) this.ops.push(["prop", id, "value", n.value]);
        if (n.checked) this.ops.push(["prop", id, "checked", true]);
      }
      this.sync(n);
    }
    return id;
  }

  /** Bring the engine's child list for this parent in line with the DOM's, with the fewest moves. */
  private sync(parent: DomNode) {
    const pid = this.ids.get(parent)!;
    const now = Array.from(parent.childNodes).filter((c) => c.nodeType !== DOCUMENT && c.nodeType !== 10).map((c) => this.describe(c));
    const keep = new Set(now);
    const had = this.kids.get(pid) ?? [];
    for (const id of had) if (!keep.has(id)) this.ops.push(["remove", pid, id]);
    const list = had.filter((id) => keep.has(id));
    for (let i = now.length - 1; i >= 0; i--) {
      const id = now[i]!, before = now[i + 1] ?? null;
      const at = list.indexOf(id);
      if (at >= 0 && (list[at + 1] ?? null) === before) continue;
      if (at >= 0) list.splice(at, 1);
      list.splice(before === null ? list.length : list.indexOf(before), 0, id);
      this.ops.push(["insert", pid, id, before]);
    }
    this.kids.set(pid, now);
  }
}
