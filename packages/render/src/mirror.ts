// The TS twin of the engine: it applies the op stream to its own tree, knowing
// nothing of React or the recording DOM. The Rust engine takes the same ops and
// adds layout, paint and hit-testing; this one answers what is on screen.

import { ROOT, type Op } from "./ops.ts";

export interface MirrorNode {
  id: number;
  tag: string | null; // null for a text node
  text: string;
  attrs: Map<string, string>;
  style: Map<string, string>;
  props: Map<string, string | boolean>;
  parent: MirrorNode | null;
  children: MirrorNode[];
}

const blank = (id: number, tag: string | null, text = ""): MirrorNode =>
  ({ id, tag, text, attrs: new Map(), style: new Map(), props: new Map(), parent: null, children: [] });

export class Mirror {
  private nodes = new Map<number, MirrorNode>([[ROOT, blank(ROOT, "div")]]);
  get root(): MirrorNode { return this.need(ROOT); }

  apply(ops: readonly Op[]) {
    for (const op of ops) {
      switch (op[0]) {
        case "el": this.nodes.set(op[1], blank(op[1], op[2])); break;
        case "text": this.nodes.set(op[1], blank(op[1], null, op[2])); break;
        case "setText": this.need(op[1]).text = op[2]; break;
        case "attr": put(this.need(op[1]).attrs, op[2], op[3]); break;
        case "style": put(this.need(op[1]).style, op[2], op[3]); break;
        case "prop": this.need(op[1]).props.set(op[2], op[3]); break;
        case "remove": {
          const parent = this.need(op[1]), child = this.need(op[2]);
          parent.children = parent.children.filter((c) => c !== child);
          child.parent = null;
          break;
        }
        case "insert": {
          const parent = this.need(op[1]), child = this.need(op[2]);
          if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
          const at = op[3] === null ? -1 : parent.children.findIndex((c) => c.id === op[3]);
          parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
          child.parent = parent;
          break;
        }
      }
    }
  }

  private need(id: number): MirrorNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`op names node ${id}, which no op created`);
    return n;
  }

  /** The visible text under a node, the way a reader would see it. */
  text(node: MirrorNode = this.root): string {
    return node.tag === null ? node.text : node.children.map((c) => this.text(c)).join("");
  }

  /** Every node on screen that matches, in document order. */
  findAll(match: (n: MirrorNode) => boolean, from: MirrorNode = this.root): MirrorNode[] {
    const out: MirrorNode[] = [];
    const walk = (n: MirrorNode) => { if (match(n)) out.push(n); n.children.forEach(walk); };
    walk(from);
    return out;
  }
}

function put<V>(map: Map<string, V>, key: string, value: V | null) {
  if (value === null) map.delete(key); else map.set(key, value);
}
