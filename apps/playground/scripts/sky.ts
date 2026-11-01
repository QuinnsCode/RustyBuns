// Bakes eqosys's day-and-night sky into public/index.html (between the sky markers), so the static page needs no Worker.
// The sun-or-moon double-click that swaps day and night comes along with it.
// Run `bun run sky` after the sky changes in apps/eqosys/src/app/Sky.tsx.
import { Sky, skyCss } from "../../eqosys/src/app/Sky.tsx";
import { THEME_SCRIPT } from "../../eqosys/src/app/Theme.tsx";

// react-dom is eqosys's dependency, not ours: resolve it from there.
const eqosys = `${import.meta.dir}/../../eqosys`;
const { renderToStaticMarkup } = await import(Bun.resolveSync("react-dom/server", eqosys));

const file = `${import.meta.dir}/../public/index.html`;
const swap = (html: string, tag: string, body: string) => {
  const re = new RegExp(`(<!--${tag}-->)[\\s\\S]*?(<!--/${tag}-->)`);
  if (!re.test(html)) throw new Error(`no <!--${tag}--> markers in index.html`);
  return html.replace(re, (_, a: string, b: string) => `${a}\n${body}\n${b}`);
};
let html = await Bun.file(file).text();
html = swap(html, "sky-css", `<style>${skyCss(0)}</style>`);
html = swap(html, "sky", renderToStaticMarkup(Sky()));
// Double-click the sun or the moon to swap day and night (kept in localStorage), as on eqosys.
html = swap(html, "sky-js", `<script>${THEME_SCRIPT}</script>`);
await Bun.write(file, html);
console.log("sky baked into public/index.html");
