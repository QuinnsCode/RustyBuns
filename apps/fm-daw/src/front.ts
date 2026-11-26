// Qollab Studio's front door (/door.html): LEARN, BUILD and PLAY, each a row of cards, each card opening on its
// sector's first step. `qdoor` is the harness for probes and the journey test (test/front-door.test.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { iconSvg, PATHS, SECTORS, type PathId } from "./paths.ts";

const list = document.getElementById("paths")!;
for (const s of SECTORS) {
  const section = document.createElement("section");
  section.className = "sector";
  section.dataset.sector = s.id;
  section.innerHTML = `<h2></h2><p class="line"></p><div class="cards"></div>`;
  section.querySelector("h2")!.textContent = s.word;
  section.querySelector(".line")!.textContent = s.line;
  const cards = section.querySelector(".cards")!;
  for (const p of PATHS.filter((p) => p.sector === s.id)) {
    const a = document.createElement("a");
    a.className = "path";
    a.href = p.href;
    a.dataset.path = p.id;
    a.title = `${p.name}: opens on ${p.first}`;
    a.innerHTML = `<span class="icon">${iconSvg(p.icon, 26)}</span><span class="text"><b></b><span class="does"></span></span>`;
    a.querySelector("b")!.textContent = p.name;
    a.querySelector(".does")!.textContent = p.does;
    if (p.signIn) a.querySelector(".text")!.insertAdjacentHTML("beforeend", '<span class="tag">Sign in with eqosys</span>');
    cards.append(a);
  }
  list.append(section);
}

declare global { interface Window { qdoor: typeof harness } }
const harness = {
  /** Each card as drawn: its path, the word it sits under, its name, where it goes, whether its name sits on one line, and the page's overflow. */
  state: () => ({
    paths: [...list.querySelectorAll<HTMLAnchorElement>("a.path")].map((a) => {
      const b = a.querySelector("b")!, line = parseFloat(getComputedStyle(b).lineHeight);
      const sector = a.closest<HTMLElement>(".sector")?.dataset.sector;
      return { id: a.dataset.path, sector, name: b.textContent, href: a.getAttribute("href"), oneLine: b.getBoundingClientRect().height <= line * 1.2 && b.scrollWidth <= b.clientWidth };
    }),
    overflowX: document.documentElement.scrollWidth > innerWidth,
  }),
  /** Walks through a path's door, as a click on its card. */
  open: (id: PathId) => list.querySelector<HTMLAnchorElement>(`a[data-path="${id}"]`)?.click(),
};
window.qdoor = harness;
