// Qollab Studio's front door (/door.html): the six paths as cards, each opening on its first step. `qdoor` is the
// harness for probes and the journey test (test/front-door.test.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { iconSvg, PATHS, type PathId } from "./paths.ts";

const list = document.getElementById("paths")!;
for (const p of PATHS) {
  const a = document.createElement("a");
  a.className = "path";
  a.href = p.href;
  a.dataset.path = p.id;
  a.title = `${p.name}: opens on ${p.first}`;
  a.innerHTML = `<span class="icon">${iconSvg(p.icon, 26)}</span><span class="text"><b></b><span class="does"></span></span>`;
  a.querySelector("b")!.textContent = p.name;
  a.querySelector(".does")!.textContent = p.does;
  if (p.signIn) a.querySelector(".text")!.insertAdjacentHTML("beforeend", '<span class="tag">Sign in with eqosys</span>');
  list.append(a);
}

declare global { interface Window { qdoor: typeof harness } }
const harness = {
  /** Each card as drawn: its path, name, where it goes, whether its name sits on one line, and the page's overflow. */
  state: () => ({
    paths: [...list.querySelectorAll<HTMLAnchorElement>("a.path")].map((a) => {
      const b = a.querySelector("b")!, line = parseFloat(getComputedStyle(b).lineHeight);
      return { id: a.dataset.path, name: b.textContent, href: a.getAttribute("href"), oneLine: b.getBoundingClientRect().height <= line * 1.2 && b.scrollWidth <= b.clientWidth };
    }),
    overflowX: document.documentElement.scrollWidth > innerWidth,
  }),
  /** Walks through a path's door, as a click on its card. */
  open: (id: PathId) => list.querySelector<HTMLAnchorElement>(`a[data-path="${id}"]`)?.click(),
};
window.qdoor = harness;
