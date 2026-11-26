// Qollab Studio's front door (/door.html), a landing page (#6019): the live field at dusk (src/front-hero.ts) with Start
// learning and Start building, then LEARN, BUILD and PLAY, each a row of cards opening on its sector's first step, the
// pedal-to-show chain, what works today, and a word for crews and for classes. `qdoor` is the harness for probes and the
// journey tests (test/front-door.test.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { mountHero } from "./front-hero.ts";
import { CHAIN, ICON, iconSvg, LIVE, PATHS, pathOf, PITCHES, SECTORS, type PathId } from "./paths.ts";

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

const hero = mountHero(document.getElementById("hero")!);

const chain = document.getElementById("chain")!;
CHAIN.forEach((c, i) => {
  const p = pathOf(c.path), li = document.createElement("li");
  li.innerHTML = `<a href="${p.href}" data-step="${i + 1}"><span class="head">${iconSvg(p.icon, 20)}<b></b></span><span></span></a>`;
  li.querySelector("b")!.textContent = c.step;
  li.querySelector("a > span:last-child")!.textContent = c.does;
  chain.append(li);
});
const live = document.getElementById("live")!;
for (const l of LIVE) {
  const li = document.createElement("li");
  li.innerHTML = `${iconSvg(ICON.check, 18)}<span><b></b> </span>`;
  li.querySelector("b")!.textContent = pathOf(l.path).name;
  li.querySelector("span")!.append(l.line);
  live.append(li);
}
const pitches = document.getElementById("pitches")!;
for (const w of PITCHES) {
  const p = pathOf(w.path), a = document.createElement("a");
  a.href = p.href;
  a.innerHTML = `<span class="icon">${iconSvg(p.icon, 26)}</span><span><b></b><p></p></span>`;
  a.querySelector("b")!.textContent = w.who;
  a.querySelector("p")!.textContent = w.line;
  pitches.append(a);
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
  /** The live field: `hero.state()` as drawn, `hero.set({ tempC, humidity, bank })` as the sliders and the mountain button. */
  hero,
};
window.qdoor = harness;
