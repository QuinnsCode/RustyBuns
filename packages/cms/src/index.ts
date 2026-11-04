// A script editor for games. A game keeps its words in `content/*.json` (strings, numbers, lists of strings,
// and objects and lists of those, such as a tour's list of stops); `bun packages/cms/src/cli.ts <dir>` serves
// every file as a page of textareas and saves back to the same file. `content/<lang>/` holds translations (locale.ts). The page can only change text and numbers:
// the shape of the file is read from the file itself, so a form can never add, drop or retype a key.

import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isLocale, progressOf, translationOf } from "./locale.ts";

export { isLocale, localize, pickLocale, progressOf, translationOf } from "./locale.ts";

type Path = (string | number)[];
export interface Field { path: Path; list: boolean; number?: boolean; text: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isRecords = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every(isRecord);

/** The editable text in a file: every string, number and list of strings, in the order written. */
export function fieldsOf(json: unknown, path: Path = []): Field[] {
  if (typeof json === "string") return [{ path, list: false, text: json }];
  if (typeof json === "number") return [{ path, list: false, number: true, text: String(json) }];
  if (isStrings(json)) return [{ path, list: true, text: json.join("\n") }];
  if (isRecords(json)) return json.flatMap((v, i) => fieldsOf(v, [...path, i]));
  if (!isRecord(json)) return [];
  return Object.entries(json).flatMap(([k, v]) => fieldsOf(v, [...path, k]));
}

const nameOf = (p: Path) => JSON.stringify(p);

/** The file with each field's text swapped for what the form sent. Fields the form left out, and numbers that
 *  came back as something else, stay as they were. */
export function applyForm(json: unknown, form: ReadonlyMap<string, string>, path: Path = []): unknown {
  const sent = form.get(nameOf(path));
  if (typeof json === "string") return sent === undefined ? json : sent.replace(/\r\n/g, "\n").trim();
  if (typeof json === "number") return sent === undefined || sent.trim() === "" || !Number.isFinite(Number(sent)) ? json : Number(sent);
  if (isStrings(json)) return sent === undefined ? json : sent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (isRecords(json)) return json.map((v, i) => applyForm(v, form, [...path, i]));
  if (!isRecord(json)) return json;
  return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, applyForm(v, form, [...path, k])]));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `:root{--bg:#fff;--fg:#0a0a0a;--muted:#6b6b6b;--border:#e6e6e6;--border-2:#cfcfcf;--paper:#fcfbf8;--accent:#e8590c;--sans:"Geist",ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,monospace}
@media(prefers-color-scheme:dark){:root{--bg:#0e0e0e;--fg:#f2f2f2;--muted:#a0a0a0;--border:#2a2a2a;--border-2:#3d3d3d;--paper:#151515}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 var(--sans)}a{color:var(--accent)}
.wrap{max-width:820px;margin:0 auto;padding:24px 16px 96px}
nav{display:flex;gap:14px;align-items:center;margin-bottom:22px;font-weight:600}nav a{color:var(--fg);text-decoration:none;letter-spacing:-.02em}
h1{font:600 clamp(28px,5vw,44px)/1.05 var(--sans);letter-spacing:-.045em;margin:6px 0 8px}h1 em{font-style:normal;color:var(--accent)}
h2{font:600 13px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 6px}
.lede,.hint{color:var(--muted)}.hint{font-size:13px;margin:0 0 4px}
.file{border:1px solid var(--border-2);border-top:4px solid var(--accent);border-radius:8px;background:var(--paper);padding:6px 20px 18px;margin-bottom:18px}
.file section{padding:14px 0;border-bottom:1px dashed var(--border-2)}.file section:last-child{border-bottom:0;padding-bottom:0}
label{display:block;font:600 12px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px}
textarea{width:100%;font:14px/1.5 var(--sans);color:var(--fg);background:var(--bg);border:1px solid var(--border-2);border-radius:6px;padding:8px 10px;resize:vertical}
textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
.bar{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--border);padding:12px 0;display:flex;gap:14px;align-items:center}
button{font:600 14px var(--sans);color:var(--fg);background:var(--paper);border:1px solid var(--border-2);border-bottom-width:3px;border-bottom-color:var(--accent);border-radius:6px;padding:7px 16px;cursor:pointer}
button:hover{background:var(--bg)}.ok{color:var(--accent);font-weight:600}ul.files{list-style:none;padding:0;margin:0}ul.files li{padding:10px 0;border-bottom:1px dashed var(--border-2)}
.hint.src{color:var(--fg);opacity:.7;border-left:3px solid var(--border-2);padding-left:8px;white-space:pre-wrap}
input{font:14px var(--sans);color:var(--fg);background:var(--bg);border:1px solid var(--border-2);border-radius:6px;padding:7px 10px}`;

const page = (title: string, body: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style><div class="wrap">${body}</div>`,
  { headers: { "content-type": "text/html; charset=utf-8" } });

const rowsOf = (f: Field) => Math.min(24, Math.max(2, f.text.split("\n").length + (f.list ? 1 : Math.floor(f.text.length / 80))));

export interface CmsOptions { dir: string; title: string }

const sectionsOf = (fields: Field[], source?: Field[]) => {
  // a section per top-level key, or per entry of a top-level list (a tour's stops: "tourTasks 3")
  const groupOf = (p: Path) => (typeof p[1] === "number" ? `${p[0]} ${p[1] + 1}` : String(p[0] ?? ""));
  const groups = new Map<string, { f: Field; was?: Field }[]>();
  fields.forEach((f, i) => {
    if (source && f.number) return; // numbers come from the source, so a translation has none to change
    groups.set(groupOf(f.path), [...(groups.get(groupOf(f.path)) ?? []), { f, was: source?.[i] }]);
  });
  return [...groups].map(([g, fs]) => `<section><h2>${esc(g)}</h2>${fs.map(({ f, was }) => {
    const label = f.path.slice(typeof f.path[1] === "number" ? 2 : 1).join(" / ") || g;
    const hint = was ? `<p class="hint src">${esc(was.text)}</p>` : f.list ? `<p class="hint">One per line.</p>` : "";
    return `<label for="${esc(nameOf(f.path))}">${esc(label)}</label>${hint}<textarea id="${esc(nameOf(f.path))}" name="${esc(nameOf(f.path))}" rows="${f.number ? 1 : rowsOf(was ?? f)}">${esc(f.text)}</textarea>`;
  }).join("")}</section>`).join("");
};

async function writeJson(dir: string, name: string, json: unknown) {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${name}.tmp`);
  await writeFile(tmp, `${JSON.stringify(json, null, 2)}\n`);
  await rename(tmp, join(dir, name));
}

/** The editor as a request handler, so a test can drive it without a port. `/<file>` edits the source language;
 *  `/<lang>/<file>` translates it into `<dir>/<lang>/<file>`, each box under the source line it stands for. */
export function cms({ dir, title }: CmsOptions): (req: Request) => Promise<Response> {
  const names = async () => (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const langs = async () => (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && isLocale(d.name)).map((d) => d.name).sort();
  const readOr = async (path: string, or: unknown): Promise<unknown> => {
    const f = Bun.file(path);
    return (await f.exists()) ? JSON.parse(await f.text()) : or;
  };
  const head = `<nav><a href="/">${esc(title)}</a></nav>`;
  const link = (lang: string | null, n: string) => `/${lang ? `${lang}/` : ""}${encodeURIComponent(n)}`;

  return async (req) => {
    const url = new URL(req.url);
    if (req.method === "POST" && req.headers.get("origin") !== null && req.headers.get("origin") !== url.origin) return new Response("Cross-site form refused", { status: 403 });
    const all = await names();
    if (url.pathname === "/") {
      if (req.method === "POST") {
        const lang = String((await req.formData()).get("lang") ?? "").trim();
        if (!isLocale(lang)) return new Response("A language is a tag like es, fr or pt-BR", { status: 400 });
        await mkdir(join(dir, lang), { recursive: true });
        return new Response(null, { status: 303, headers: { location: "/" } });
      }
      const items = all.map((n) => `<li><a href="${link(null, n)}">${esc(n.replace(/\.json$/, ""))}</a></li>`).join("");
      const sources = Object.fromEntries(await Promise.all(all.map(async (n) => [n, await readOr(join(dir, n), null)] as const)));
      const translations = await Promise.all((await langs()).map(async (lang) => {
        const rows = await Promise.all(all.map(async (n) => {
          const { done, total } = progressOf(sources[n], await readOr(join(dir, lang, n), null));
          return `<li><a href="${link(lang, n)}">${esc(n.replace(/\.json$/, ""))}</a> <span class="hint">${done} of ${total} translated</span></li>`;
        }));
        return `<h2>${esc(lang)}</h2><ul class="files">${rows.join("")}</ul>`;
      }));
      return page(title, `${head}<h1>${esc(title)} <em>script</em></h1><p class="lede">Pick a file, change the words, save. It writes straight to <code>${esc(dir)}</code>.</p><ul class="files">${items}</ul>`
        + `<h1 style="margin-top:40px">Languages</h1><p class="lede">A translation keeps the file's shape. A line left blank reads in the original.</p>${translations.join("")}`
        + `<form method="post" class="bar"><label for="lang" style="margin:0">Add a language</label><input id="lang" name="lang" placeholder="es" size="8" required><button>Add</button></form>`);
    }
    const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const [lang, name] = parts.length === 2 ? [parts[0]!, parts[1]!] : [null, parts[0]!];
    if (parts.length > 2 || !all.includes(name) || (lang !== null && !(await langs()).includes(lang))) return new Response("Not found", { status: 404 });
    const source = await readOr(join(dir, name), null);
    const at = lang ? join(dir, lang) : dir;
    const current = lang ? translationOf(source, await readOr(join(at, name), null)) : source;
    if (req.method === "POST") {
      const form = new Map<string, string>();
      for (const [k, v] of await req.formData()) if (typeof v === "string") form.set(k, v);
      const next = applyForm(current, form);
      await writeJson(at, name, lang ? translationOf(source, next) : next);
      return new Response(null, { status: 303, headers: { location: `${link(lang, name)}?saved=1` } });
    }
    const sections = sectionsOf(fieldsOf(current), lang ? fieldsOf(source) : undefined);
    const heading = `${esc(name.replace(/\.json$/, ""))}${lang ? ` <em>${esc(lang)}</em>` : ""}`;
    return page(`${lang ? `${lang} · ` : ""}${name} · ${title}`, `${head}<h1>${heading}</h1><form method="post"><div class="file">${sections}</div><div class="bar"><button>Save</button>${url.searchParams.has("saved") ? `<span class="ok">Saved.</span>` : ""}<a href="/">All files</a></div></form>`);
  };
}

export function serveCms(opts: CmsOptions & { port: number }) {
  return Bun.serve({ hostname: "127.0.0.1", port: opts.port, fetch: cms(opts) });
}
