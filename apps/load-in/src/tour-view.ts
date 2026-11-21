// Home base in the menu: the cash, the truck, the next gig (what it pays and what you'd rent for it), the shop for the
// gear you're short of and a bigger truck, and how the last night went. The tour is kept in this browser
// (`load-in.tour`), read back through `TourSave`; with no storage it lasts the visit.
import { esc } from "@rustybuns/util";
import { gear } from "@rustybuns/gear";
import { PRICES, RIGS, type Rig, TRUCKS, type Tour, bookedRung, buy, crowd, newTour, readTour, ready } from "./tour.ts";

const KEY = "load-in.tour";

/** A rung's rig in one line, leaving out what it has none of. */
export function rigLine(r: Rig): string {
  const n = (v: number, one: string, many = `${one}s`) => (v ? `${v.toLocaleString("en-US")} ${v === 1 ? one : many}` : "");
  return [n(r.tops, "top"), n(r.subs, "sub"), n(r.wedges, "wedge"), n(r.amps, "amp channel"), `${r.kw} kW on ${r.power}`, n(r.runs, "cable run"), n(r.crew, "on the crew", "on the crew")]
    .filter(Boolean).join(", ");
}

export function loadTour(): Tour {
  try { const s = localStorage.getItem(KEY); return s ? readTour(JSON.parse(s)) : newTour(); } catch { return newTour(); }
}
export function saveTour(t: Tour) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* the tour lasts this visit */ }
}

/** Home base starts open only for someone who has played a night: a newcomer sees Play, not the books. */
export function homeOpen(t: Tour): boolean {
  return t.nights.length > 0;
}

/** The gig listing goes in `parent`; the Home base note in `side` (the flyer's side column), or under the gig without one. */
export function mountTour(parent: HTMLElement, get: () => Tour, set: (t: Tour) => void, side: HTMLElement = parent) {
  const box = document.createElement("div"), home = document.createElement("div");
  box.className = home.className = "tour";
  parent.append(box);
  side.append(home);
  let note = "";
  const paint = () => {
    const t = get(), rung = bookedRung(t), r = ready(t, rung.level), truck = TRUCKS.find((x) => x.id === t.truck)!;
    const last = t.nights.at(-1), rig = RIGS[rung.level.name], heads = crowd(t, rung.level).heads;
    const short = Object.entries(r.missing);
    const bigger = TRUCKS.find((x) => x.kg > truck.kg);
    const shop = [
      ...short.map(([id]) => `<button type="button" data-buy="${esc(id)}" title="Buy one">${esc(gear(id).what)}: $${PRICES[id]}</button>`),
      bigger ? `<button type="button" data-buy="${bigger.id}" title="Buy it">${bigger.name}, carries ${bigger.kg} kg: $${bigger.price}</button>` : "",
    ].filter(Boolean);
    const tonight = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    // Folded for a first-timer (Play comes first), open once a night is played; a repaint keeps whatever the player chose.
    const open = home.querySelector<HTMLDetailsElement>("details.home")?.open ?? homeOpen(t);
    box.innerHTML = `<p class="gig"><span class="when">Next gig / ${esc(tonight)}</span><b class="venue-name">${esc(rung.name)}</b><span class="terms">Pays $${r.fee} for a full room. The kit weighs ${r.kg} kg.</span></p>`;
    home.innerHTML = `<details class="home paper tape"${open ? " open" : ""}><summary><b>Home base</b> <span class="sum">$${t.cash} in the bank</span></summary>`
      + `<span>$${t.cash} in the bank, the ${esc(truck.name.toLowerCase())} carries ${truck.kg} kg</span>`
      + (last ? `<span class="${last.pass ? "pass" : "warn"}">Last night: show ${last.score}, ${last.pay < 0 ? "lost" : "took home"} $${Math.abs(last.pay)}${last.pass ? ", and they booked you on" : ", and they'll have you back"}</span>` : "")
      + `<span>Your following: ${t.following}. The room holds ${rig?.people ?? "?"}: about ${heads} tonight.</span>`
      + (rig ? `<span>The rig: ${rigLine(rig)}</span>` : "")
      + `<span>${r.rent ? `Rent tonight $${r.rent}: ${[...short.map(([id, n]) => `${n} x ${esc(gear(id).what)}`), r.rentTruck ? `a ${r.rentTruck.replace("-", " ")}` : ""].filter(Boolean).join("; ")}` : "You own the whole kit and it fits the truck: no rent tonight."}</span>`
      + (shop.length ? `<span>Buy to cut the rent:</span><div class="shop">${shop.join("")}</div>` : "")
      + `<small class="warn">${esc(note)}</small></details>`;
  };
  home.addEventListener("click", (e) => {
    const id = e.target instanceof HTMLElement ? e.target.dataset.buy : undefined;
    if (!id) return;
    const r = buy(get(), id);
    note = r.ok ? "" : r.why;
    if (r.ok) set(r.tour);
    paint();
  });
  paint();
  return { update: paint };
}
