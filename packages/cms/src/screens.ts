// The first screens a person meets, one page each: the screen's picture (a computer and a phone) beside every line
// on it as a box, saved back to the app's own JSON file. A screen lists the file and, when the file holds more than
// that one screen, the top-level keys that belong to it. Pictures are PNGs in `shots` named `<id>-desktop.png` and
// `<id>-phone.png`; `shoot` (given by the caller, which knows how to start an app) takes them again.

import { basename, dirname, join } from "node:path";
import { applyForm, esc, fieldsOf, page, sectionsOf, writeJson } from "./index.ts";

export interface Screen {
  /** The link's last part and the pictures' name: `eqosys-home`. */
  id: string;
  /** The folder under apps/: `eqosys`. */
  app: string;
  /** What the person sees, in a few words: "eqosys: the front door". */
  name: string;
  /** Where they come from and what they want there, one line. */
  why: string;
  /** The JSON file with the words, absolute. */
  file: string;
  /** Only these top-level keys of the file are this screen's (a file holding several screens). */
  keys?: string[];
  /** The page's path when the app runs (`/login`), for the pictures. */
  path?: string;
}

export interface ScreensOptions {
  title: string;
  screens: Screen[];
  /** Folder of `<id>-desktop.png` and `<id>-phone.png`. */
  shots: string;
  /** Takes both pictures of one screen again, into `shots`. Left out: no retake button. */
  shoot?: (s: Screen) => Promise<string | null>;
}

const CSS = `.wrap{max-width:1240px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;list-style:none;padding:0;margin:20px 0 0}
.grid a{display:grid;gap:6px;color:var(--fg);text-decoration:none;border:1px solid var(--border-2);border-radius:8px;padding:10px;background:var(--paper)}
.grid a:hover{border-color:var(--accent)}.grid b{font-weight:600}.grid small{color:var(--muted)}
.n{font:600 12px var(--mono);color:var(--accent)}
.pic{width:100%;aspect-ratio:16/9;object-fit:cover;object-position:top;border-radius:6px;border:1px solid var(--border);background:var(--bg)}
.none{display:grid;place-items:center;color:var(--muted);font-size:13px;border:1px dashed var(--border-2)}
.split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:24px;align-items:start}
.shots{position:sticky;top:12px;display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:10px;align-items:start}
.shots img{width:100%;border-radius:6px;border:1px solid var(--border);display:block}.shots .phone{grid-column:2}
.shots form{grid-column:1/-1;display:flex;gap:10px;align-items:center}
.why{color:var(--muted);margin:0 0 14px}.pager{display:flex;gap:14px;margin:4px 0 0;font-weight:600}
.err{color:#c0392b;font-weight:600}
@media(max-width:860px){.split{grid-template-columns:1fr}.shots{position:static}}`;

const SHOT = /^[\w-]+-(desktop|phone)\.png$/;

/** Only the keys this screen owns, so a file with several screens shows the right boxes on each. */
const pick = (json: unknown, keys?: string[]) =>
  keys && json !== null && typeof json === "object" && !Array.isArray(json)
    ? Object.fromEntries(Object.entries(json).filter(([k]) => keys.includes(k))) : json;

export function screens({ title, screens: list, shots, shoot }: ScreensOptions): (req: Request) => Promise<Response> {
  const read = async (s: Screen): Promise<unknown> => JSON.parse(await Bun.file(s.file).text());
  const pic = async (id: string, kind: "desktop" | "phone", cls: string) => {
    const f = Bun.file(join(shots, `${id}-${kind}.png`));
    return (await f.exists())
      ? `<img class="${cls}" src="/shot/${id}-${kind}.png?t=${f.lastModified}" alt="${kind === "phone" ? "On a phone" : "On a computer"}">`
      : `<div class="${cls} pic none">No picture yet</div>`;
  };
  const head = `<nav><a href="/">${esc(title)}</a></nav>`;

  return async (req) => {
    const url = new URL(req.url);
    if (req.method === "POST" && req.headers.get("origin") !== null && req.headers.get("origin") !== url.origin) return new Response("Cross-site form refused", { status: 403 });
    const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);

    if (parts[0] === "shot" && parts.length === 2 && SHOT.test(parts[1]!)) {
      const f = Bun.file(join(shots, parts[1]!));
      return (await f.exists()) ? new Response(f, { headers: { "content-type": "image/png", "cache-control": "no-store" } }) : new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/") {
      const cards = await Promise.all(list.map(async (s, i) => `<li><a href="/${s.id}"><span class="n">${i + 1}</span>${await pic(s.id, "desktop", "pic")}<b>${esc(s.name)}</b><small>${esc(s.why)}</small></a></li>`));
      return page(title, `${head}<h1>${esc(title)}</h1><p class="lede">The first ${list.length} screens a new person is likely to see, in about the order they meet them. Open one, change the words, save. Each save writes the app's own file, and the app shows it on its next load.</p><ul class="grid">${cards.join("")}</ul>`, CSS);
    }

    const at = list.findIndex((s) => s.id === parts[0]);
    const s = list[at];
    if (!s || parts.length > 2 || (parts.length === 2 && parts[1] !== "shot")) return new Response("Not found", { status: 404 });
    const here = `/${s.id}`;

    if (req.method === "POST" && parts[1] === "shot") {
      const err = shoot ? await shoot(s) : "No camera here";
      return new Response(null, { status: 303, headers: { location: err ? `${here}?shot=${encodeURIComponent(err)}` : `${here}?shot=ok` } });
    }
    if (req.method === "POST") {
      const form = new Map<string, string>();
      for (const [k, v] of await req.formData()) if (typeof v === "string") form.set(k, v);
      await writeJson(dirname(s.file), basename(s.file), applyForm(await read(s), form));
      return new Response(null, { status: 303, headers: { location: `${here}?saved=1` } });
    }

    const prev = list[at - 1], next = list[at + 1];
    const pager = `<div class="pager">${prev ? `<a href="/${prev.id}">Back: ${esc(prev.name)}</a>` : ""}${next ? `<a href="/${next.id}">Next: ${esc(next.name)}</a>` : ""}</div>`;
    const shotNote = url.searchParams.get("shot");
    const retake = shoot ? `<form method="post" action="${here}/shot"><button>Take new pictures</button><span class="hint">About half a minute: it starts the app and looks.</span>${shotNote === "ok" ? `<span class="ok">New pictures.</span>` : shotNote ? `<span class="err">${esc(shotNote)}</span>` : ""}</form>` : "";
    const fields = sectionsOf(fieldsOf(pick(await read(s), s.keys)));
    const file = s.file.split("/apps/")[1] ?? s.file;
    return page(`${at + 1}. ${s.name} · ${title}`, `${head}<h1><em>${at + 1}</em> ${esc(s.name)}</h1><p class="why">${esc(s.why)} <span class="hint">apps/${esc(file)}</span></p>`
      + `<div class="split"><div class="shots">${await pic(s.id, "desktop", "desktop")}${await pic(s.id, "phone", "phone")}${retake}</div>`
      + `<form method="post"><div class="file">${fields}</div><div class="bar"><button>Save</button>${url.searchParams.has("saved") ? `<span class="ok">Saved. Take new pictures to see it.</span>` : ""}</div></form></div>${pager}`, CSS);
  };
}
