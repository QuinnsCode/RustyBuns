// Home base in the menu: the cash, the truck, the next gig (what it pays and what you'd rent for it), the shop for the
// gear you're short of and a bigger truck, and how the last night went. The tour is kept in this browser
// (`load-in.tour`), read back through `TourSave`; with no storage it lasts the visit.
import { esc } from "@rustybuns/util";
import { gear } from "@rustybuns/gear";
import { PRICES, TRUCKS, type Tour, bookedRung, buy, newTour, readTour, ready } from "./tour.ts";

const KEY = "load-in.tour";

export function loadTour(): Tour {
  try { const s = localStorage.getItem(KEY); return s ? readTour(JSON.parse(s)) : newTour(); } catch { return newTour(); }
}
export function saveTour(t: Tour) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* the tour lasts this visit */ }
}

export function mountTour(parent: HTMLElement, get: () => Tour, set: (t: Tour) => void) {
  const box = document.createElement("div");
  box.className = "tour";
  parent.append(box);
  let note = "";
  const paint = () => {
    const t = get(), rung = bookedRung(t), r = ready(t, rung.level), truck = TRUCKS.find((x) => x.id === t.truck)!;
    const last = t.nights.at(-1);
    const short = Object.entries(r.missing);
    const bigger = TRUCKS.find((x) => x.kg > truck.kg);
    const shop = [
      ...short.map(([id]) => `<button type="button" data-buy="${esc(id)}" title="Buy one">${esc(gear(id).what)}: $${PRICES[id]}</button>`),
      bigger ? `<button type="button" data-buy="${bigger.id}" title="Buy it">${bigger.name}, carries ${bigger.kg} kg: $${bigger.price}</button>` : "",
    ].filter(Boolean);
    const tonight = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    box.innerHTML = `<p class="gig"><span class="when">Next gig / ${esc(tonight)}</span><b class="venue-name">${esc(rung.name)}</b><span class="terms">Pays $${r.fee}. The kit weighs ${r.kg} kg.</span></p>`
      + `<div class="home paper tape"><b>Home base</b>`
      + `<span>$${t.cash} in the bank, the ${esc(truck.name.toLowerCase())} carries ${truck.kg} kg</span>`
      + (last ? `<span class="${last.pass ? "pass" : "warn"}">Last night: show ${last.score}, ${last.pay < 0 ? "lost" : "took home"} $${Math.abs(last.pay)}${last.pass ? ", and they booked you on" : ", and they'll have you back"}</span>` : "")
      + `<span>${r.rent ? `Rent tonight $${r.rent}: ${[...short.map(([id, n]) => `${n} x ${esc(gear(id).what)}`), r.rentTruck ? `a ${r.rentTruck.replace("-", " ")}` : ""].filter(Boolean).join("; ")}` : "You own the whole kit and it fits the truck: no rent tonight."}</span>`
      + (shop.length ? `<span>Buy to cut the rent:</span><div class="shop">${shop.join("")}</div>` : "")
      + `<small class="warn">${esc(note)}</small></div>`;
  };
  box.addEventListener("click", (e) => {
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
