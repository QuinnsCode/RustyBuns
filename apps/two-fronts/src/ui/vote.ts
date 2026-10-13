// The end-of-match vote: a card for each mode, and everyone's pointer on the screen as they move it.
// Each voter clicks one card, once. A voter is here (this screen's mouse or finger; in hotseat the
// one pointer votes for each seat in turn), away (the other seat online, its pointer coming over
// the campaign's socket) or the AI (its vote is already in; its pointer wanders over to that card
// and clicks it). The screen only shows the vote. Whoever opens it counts the votes.
import { MATCH_MODES, type Faction, type MatchMode } from "../battle/contract.ts";
import { FACTION_NAMES } from "../war/galaxy.ts";
import { icon } from "./icons.ts";

export const MODE_INFO: Record<MatchMode, { name: string; icon: string; blurb: string }> = {
  conquest: { name: "Conquest", icon: "flag", blurb: "Every post up for grabs. Hold more, and they bleed." },
  assault: { name: "Assault", icon: "swords", blurb: "One post live at a time. Take it, hold it, push on." },
  hill: { name: "King of the hill", icon: "mountain", blurb: "One post, and it moves. Stand on it to drain them." },
  holdout: { name: "Hold-out", icon: "shield", blurb: "The defender holds every post against growing waves." },
  escort: { name: "Escort", icon: "crown", blurb: "Walk the champion to the keep, or bring them down." },
};

export interface VoteSeat { faction: Faction; who: "here" | "away" | "ai"; vote?: MatchMode }
export interface VoteOptions {
  title: string;
  text?: string;
  seats: VoteSeat[];
  picked?: MatchMode | null;
  leave?: { label: string; title: string }; // the button before the pick: "Later" unless said
  cast(f: Faction, mode: MatchMode): void; // a vote from this screen
  moved?(x: number, y: number): void;      // this screen's pointer, 0..1 across the cards
  done(picked: MatchMode | null): void;    // Continue once picked, or leave before
}
export interface VoteScreen {
  point(f: Faction, x: number, y: number): void;
  update(votes: Partial<Record<Faction, MatchMode>>, picked: MatchMode | null): void;
  close(): void;
}

export function voteScreen(root: HTMLElement, o: VoteOptions): VoteScreen {
  const seats = o.seats.map((s) => ({ ...s }));
  let pickedNow = o.picked ?? null, raf = 0, closed = false;
  // Where each pointer is, 0..1 across the cards. The AI's starts off to one side and has somewhere to go.
  const at = new Map<Faction, { x: number; y: number; seen: boolean }>();
  const ai = seats.filter((s) => s.who === "ai").map((s) => ({ seat: s, shown: false, t0: performance.now(), from: { x: 0.9, y: 1.1 } }));
  const up = () => seats.find((s) => s.who === "here" && !s.vote); // whose vote the pointer here casts

  root.innerHTML = `<div class="vote-box">
    <h2>${o.title}</h2>${o.text ? `<p>${o.text}</p>` : ""}
    <p class="vote-who"></p>
    <div class="vote-cards">${MATCH_MODES.map((m) => `<button type="button" class="vote-card" data-mode="${m}">
      ${icon(MODE_INFO[m].icon, 26)}<b>${MODE_INFO[m].name}</b><small>${MODE_INFO[m].blurb}</small><span class="vote-dots"></span></button>`).join("")}
      ${seats.map((s) => `<i class="vote-pointer ${s.faction}" data-pointer="${s.faction}" hidden>${icon("mouse-pointer-2", 22)}<span>${FACTION_NAMES[s.faction]}</span></i>`).join("")}
    </div>
    <div class="vote-foot"><button type="button" class="vote-go primary"></button></div>
  </div>`;
  root.hidden = false;
  const cards = root.querySelector<HTMLElement>(".vote-cards")!, go = root.querySelector<HTMLButtonElement>(".vote-go")!;
  const rel = (e: PointerEvent) => {
    const r = cards.getBoundingClientRect();
    return { x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.height) };
  };
  const centre = (m: MatchMode) => {
    const r = cards.getBoundingClientRect(), c = cards.querySelector<HTMLElement>(`[data-mode="${m}"]`)!.getBoundingClientRect();
    return { x: (c.left + c.width / 2 - r.left) / Math.max(1, r.width), y: (c.top + c.height / 2 - r.top) / Math.max(1, r.height) };
  };

  const draw = () => {
    const shown = (s: VoteSeat) => s.who !== "ai" || ai.find((a) => a.seat === s)?.shown;
    // The pick shows once the AI's pointer has made it over and clicked.
    const picked = ai.every((a) => a.shown) ? pickedNow : null;
    for (const card of cards.querySelectorAll<HTMLElement>(".vote-card")) {
      const m = card.dataset.mode as MatchMode, me = up();
      card.querySelector(".vote-dots")!.innerHTML = seats.filter((s) => s.vote === m && shown(s)).map((s) => `<i class="dot ${s.faction}" title="${FACTION_NAMES[s.faction]}"></i>`).join("");
      card.classList.toggle("picked", picked === m);
      card.classList.toggle("off", !!picked || !me); // not disabled: a disabled button would swallow the pointer
    }
    const me = up(), waiting = seats.filter((s) => !s.vote || !shown(s));
    root.querySelector(".vote-who")!.textContent = picked ? `Next match: ${MODE_INFO[picked].name}`
      : me ? `${FACTION_NAMES[me.faction]}, pick the next match` : `Waiting for the ${waiting.map((s) => FACTION_NAMES[s.faction]).join(" and ")}`;
    go.textContent = picked ? "Continue" : o.leave?.label ?? "Later";
    go.title = picked ? "" : o.leave?.title ?? "Back to the map. The vote stays open.";
  };

  const frame = (now: number) => {
    if (closed) return;
    for (const a of ai) {
      // Wander over: ease toward the card along a lazy curve, then click it.
      if (!a.seat.vote) continue;
      const k = Math.min(1, (now - a.t0) / 2600), ease = k * k * (3 - 2 * k), to = centre(a.seat.vote);
      const wob = Math.sin(now / 260) * 0.05 * (1 - k);
      at.set(a.seat.faction, { x: a.from.x + (to.x - a.from.x) * ease + wob, y: a.from.y + (to.y - a.from.y) * ease + Math.cos(now / 340) * 0.04 * (1 - k), seen: true });
      if (k >= 1 && !a.shown) { a.shown = true; draw(); }
    }
    for (const s of seats) {
      const el = root.querySelector<HTMLElement>(`[data-pointer="${s.faction}"]`)!, p = at.get(s.faction);
      el.hidden = !p?.seen;
      if (p) { el.style.left = `${p.x * 100}%`; el.style.top = `${p.y * 100}%`; }
      el.classList.toggle("up", s === up());
    }
    raf = requestAnimationFrame(frame);
  };

  // This screen's pointer: the mouse, or a finger on the cards.
  const move = (e: PointerEvent) => {
    const me = up() ?? seats.find((s) => s.who === "here");
    if (!me) return;
    const p = rel(e);
    at.set(me.faction, { ...p, seen: true });
    o.moved?.(p.x, p.y);
  };
  root.onpointermove = move;
  root.onpointerdown = move;
  root.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (t === go) return finish();
    const m = t?.dataset.mode as MatchMode | undefined, me = up();
    if (!m || !me || pickedNow) return;
    me.vote = m;
    o.cast(me.faction, m);
    draw();
  };
  const finish = () => { close(); o.done(ai.every((a) => a.shown) ? pickedNow : null); };
  const close = () => { closed = true; cancelAnimationFrame(raf); root.hidden = true; root.innerHTML = ""; root.onpointermove = root.onpointerdown = root.onclick = null; };

  draw();
  raf = requestAnimationFrame(frame);
  return {
    point(f, x, y) { at.set(f, { x, y, seen: true }); },
    update(votes, p) {
      for (const s of seats) if (votes[s.faction]) s.vote = votes[s.faction];
      pickedNow = p;
      draw();
    },
    close,
  };
}
