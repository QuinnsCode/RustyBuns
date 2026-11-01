// Layout: reviewing a model change by picture: which changed files are models, and the before/after page
// A reviewer judges a model by looking, not by reading node coordinates (#3055). The render itself is headless
// Blender (scripts/model-review.ts); this file is the pure part. Imports nothing.

/** The changed paths that are models a picture can show (GLB files; a sheet's GLB changes in the same commit). */
export const modelPaths = (changed: string[]): string[] => changed.filter((p) => /\.glb$/i.test(p)).sort();

/** One model's pair of renders: a side is a data URL or a relative path, null when the file did not exist there. */
export interface ModelPair { path: string; before: string | null; after: string | null }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The review page: each model with before and after side by side, "new" or "removed" where a side is missing. */
export function sideBySide(pairs: ModelPair[], title = "Model changes"): string {
  const side = (label: string, src: string | null) =>
    `<figure><figcaption>${label}</figcaption>${src ? `<img src="${esc(src)}" alt="${label}">` : `<div class="none">${label === "Before" ? "new" : "removed"}</div>`}</figure>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui;margin:24px;background:#fff;color:#111}h2{font:600 14px ui-monospace,monospace;margin:24px 0 8px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}
img{width:100%;border:1px solid #ccc}figure:first-child figcaption{color:#b42318}figure:last-child figcaption{color:#067647}
.none{border:1px dashed #999;padding:48px;text-align:center;color:#666}</style>
<h1>${esc(title)}</h1>${pairs.length ? pairs.map((p) => `<h2>${esc(p.path)}</h2><div class="row">${side("Before", p.before)}${side("After", p.after)}</div>`).join("") : "<p>No models changed.</p>"}`;
}
