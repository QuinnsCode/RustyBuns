// Workers AI off the edge: there's no model here, so env.AI is there (an app that checks for it
// still loads). Text embeddings (@cf/baai/bge-*) are answered by a small built-in embedder, so
// semantic search code runs unchanged; every other call fails with an error that says why,
// instead of "Cannot read properties of undefined".
//
// The embedder hashes words and character trigrams into a unit vector of the model's size. It
// matches shared words and word stems, not meaning ("car" and "automobile" are far apart): a real
// model would add tens of MB to the binary. Deploy to Cloudflare for the real vectors.

const DIMS: Record<string, number> = {
  "@cf/baai/bge-small-en-v1.5": 384,
  "@cf/baai/bge-base-en-v1.5": 768,
  "@cf/baai/bge-large-en-v1.5": 1024,
  "@cf/baai/bge-m3": 1024,
};

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** A deterministic unit vector: each word, and each trigram of it, adds to the dimension it hashes to. */
export function embed(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
    v[hash(w) % dims] += 2;
    const p = `^${w}$`;
    for (let i = 0; i + 3 <= p.length; i++) v[hash(p.slice(i, i + 3)) % dims] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export class LocalAi {
  constructor(readonly binding = "AI") {}
  private no(what: string): never {
    throw new Error(`Workers AI (${this.binding}): ${what} isn't available on the desktop; it runs only on Cloudflare`);
  }
  async run(model: string, inputs?: unknown, _opts?: unknown): Promise<unknown> {
    const dims = DIMS[model];
    if (!dims) this.no(`run("${model}")`);
    const t = (inputs as { text?: string | string[] } | undefined)?.text;
    if (typeof t !== "string" && !Array.isArray(t)) throw new Error(`Workers AI (${this.binding}): run("${model}") needs { text: string | string[] }`);
    const data = (Array.isArray(t) ? t : [t]).map((s) => embed(String(s), dims));
    return { shape: [data.length, dims], data };
  }
  async models(): Promise<never> { this.no("models()"); }
  gateway(id: string): never { this.no(`gateway("${id}")`); }
  autorag(id: string): never { this.no(`autorag("${id}")`); }
  toMarkdown(): never { this.no("toMarkdown()"); }
}

export const ai = (binding?: string) => new LocalAi(binding);
