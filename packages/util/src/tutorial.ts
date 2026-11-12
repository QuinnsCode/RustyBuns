// A game's first-time tutorial: a coach card that names one thing to do, waits until the player has done it, and
// moves on. It can't be closed, so everyone does it once; after that it never shows again. "Once" is kept two ways:
// in this browser (`<prefix>.tutorial`), and on the eqosys account as the shared `tutorial` achievement (apps/eqosys
// src/achievements.ts), so a signed-in player on a new device skips it too, and a guest's finish is held and sent on
// their next sign-in like any other achievement. The card is an eqosys surface (`.eq`), so it wears the game's skin.
import { wearSkin } from "./skin.ts";

/** One thing to do. `done` is read a few times a second while the step is up; make it true once the player did it. */
export interface TutorialStep {
  /** What to do, short: "Turn the aim". */
  title: string;
  /** How, one line: "The dashed line is where the disc goes." */
  say?: string;
  /** The keys (or buttons) that do it, each drawn as a key cap: ["←", "→"]. */
  keys?: string[];
  done: () => boolean;
}

/** What `tutorial` needs of the eqosys client (`eqosys(...)`): only these two, so a test can pass its own. */
export interface TutorialAccount {
  achieve(id: string): unknown;
  achievements(): Promise<{ id: string; at: number | null }[] | null>;
}

export interface TutorialConfig {
  /** The localStorage prefix, the same one the game gives `eqosys`. */
  prefix: string;
  steps: TutorialStep[];
  /** The card's heading: "How to play". */
  title?: string;
  /** The eqosys client: reads the `tutorial` achievement, and unlocks it at the end. */
  account?: TutorialAccount;
  /** Where the card goes (default `document.body`). */
  parent?: HTMLElement;
  /** Runs once, when the last step is done (not when the account says it was done before). */
  onDone?: () => void;
}

/** The achievement id every game's catalog lists for it. */
export const TUTORIAL = "tutorial";

/** The step to show: past every one done, in order (a player can do two at once). `steps.length` when all are. */
export function stepAt(steps: readonly Pick<TutorialStep, "done">[], from: number): number {
  let i = from;
  while (i < steps.length && steps[i]!.done()) i++;
  return i;
}

const kbd = (k: string) => Object.assign(document.createElement("kbd"), { textContent: k });

export function tutorial(cfg: TutorialConfig) {
  const key = `${cfg.prefix}.tutorial`;
  const kept = {
    get: () => { try { return localStorage.getItem(key) === "done"; } catch { return false; } },
    put: (on: boolean) => { try { on ? localStorage.setItem(key, "done") : localStorage.removeItem(key); } catch {} },
  };
  let at = -1, timer = 0, card: HTMLElement | null = null;
  const running = () => at >= 0;

  function draw() {
    if (!card) return;
    const n = cfg.steps.length, s = cfg.steps[at];
    card.replaceChildren();
    if (!s) return;
    const head = Object.assign(document.createElement("small"), { textContent: `${cfg.title ?? "How to play"} · ${at + 1} of ${n}` });
    const dots = Object.assign(document.createElement("span"), { className: "eq-coach-dots" });
    for (let i = 0; i < n; i++) dots.append(Object.assign(document.createElement("i"), { className: i < at ? "on" : i === at ? "now" : "" }));
    card.append(head, dots, Object.assign(document.createElement("b"), { textContent: s.title }));
    if (s.say || s.keys?.length) {
      const p = document.createElement("p");
      if (s.keys?.length) p.append(...s.keys.map(kbd), " ");
      if (s.say) p.append(s.say);
      card.append(p);
    }
  }

  function finish(saved: boolean) {
    clearInterval(timer);
    at = -1;
    kept.put(true);
    if (!saved) { void cfg.account?.achieve(TUTORIAL); cfg.onDone?.(); }
    const c = card;
    card = null;
    if (!c) return;
    if (saved) { c.remove(); return; }
    c.classList.add("eq-coach-done");
    c.replaceChildren(Object.assign(document.createElement("small"), { textContent: "Tutorial done" }), Object.assign(document.createElement("b"), { textContent: "You're ready. Have fun." }));
    setTimeout(() => c.remove(), 1800);
  }

  function tick() {
    if (!running()) return;
    const next = stepAt(cfg.steps, at);
    if (next === at) return;
    at = next;
    if (at >= cfg.steps.length) finish(false);
    else draw();
  }

  /** Whether this browser has seen the player finish it. */
  const learned = () => kept.get();

  /**
   * Start it, unless it was finished here before: answers whether it is running. While it runs, the account is asked,
   * and a `tutorial` unlock there ends it quietly (the same player on another device). Starting twice is a no-op.
   */
  function start(): boolean {
    if (running()) return true;
    if (learned() || !cfg.steps.length) return false;
    at = 0;
    wearSkin();
    card = Object.assign(document.createElement("aside"), { className: "eq eq-coach" });
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    (cfg.parent ?? document.body).append(card);
    draw();
    timer = window.setInterval(tick, 120);
    tick();
    void cfg.account?.achievements().then((list) => { if (running() && list?.some((a) => a.id === TUTORIAL && a.at !== null)) finish(true); }).catch(() => {});
    return running();
  }

  /** Forget it was done here, so the next `start` runs it again (a "How to play" button; the account keeps its badge). */
  function forget() { if (running()) finish(true); kept.put(false); }

  /** For a probe or a test: whether it is up, which step (0-based), and that step's title. */
  const state = () => ({ learned: learned(), running: running(), step: at, of: cfg.steps.length, title: cfg.steps[at]?.title ?? null });

  return { start, learned, forget, state, tick };
}
