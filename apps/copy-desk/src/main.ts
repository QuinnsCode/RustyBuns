// A small business site whose every word is in content/*.json: the built-in CMS (`bun run cms`, packages/cms) edits
// them as forms and translates them into content/<lang>/. The language is picked once at boot (?lang=, then the
// browser's) and written into the imported JSON before anything reads it.
import { localizeContent } from "@rustybuns/cms/locale";
import posts from "../content/posts.json";
import site from "../content/site.json";
import { livePosts } from "./site.ts";
import "./style.css";

const lang = localizeContent(
  { site, posts },
  import.meta.glob("../content/*/*.json", { eager: true, import: "default" }),
  [new URLSearchParams(location.search).get("lang"), ...navigator.languages],
);
document.documentElement.lang = lang;
document.title = site.brand;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const section = (id: string, title: string, ...kids: Node[]) => {
  const s = el("section");
  s.id = id;
  s.append(el("h2", title), ...kids);
  return s;
};
const link = (href: string, text: string) => { const a = el("a", text); a.href = href; return a; };

const header = el("header");
const nav = el("nav");
nav.append(link("#news", site.nav.news), link("#hours", site.nav.hours), link("#edit", site.nav.edit));
header.append(el("p", site.brand, "brand"), nav);

const hero = el("section", "", "hero");
hero.append(el("h1", site.hero.title), el("p", site.hero.body), el("p", site.tagline, "tagline"));

const shown = livePosts(posts.posts);
const list = el("div", "", "posts");
for (const p of shown) {
  const a = el("article");
  a.append(el("time", p.date), el("h3", p.title), el("p", p.body));
  list.append(a);
}
if (!shown.length) list.append(el("p", site.news.empty, "empty"));

const hours = el("ul");
for (const line of site.hours.lines) hours.append(el("li", line));

const edit = el("div");
edit.append(el("p", site.edit.body), el("p", site.edit.published, "hint"));

const main = el("main");
main.append(hero, section("news", site.news.title, list), section("hours", site.hours.title, hours), section("edit", site.edit.title, edit));
document.body.append(header, main, el("footer", site.footer));
Object.assign(window, { copyDesk: { state: () => ({ lang, brand: site.brand, posts: shown.map((p) => p.title) }) } });
