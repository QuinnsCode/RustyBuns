// Every fight HUD skin in src/hud/skins/, and which one is showing. `?hud=<id>` picks one and shows a
// chooser chip (bottom left) to step through them; without it the fight wears "classic". The chip steps through the
// owner's picks (PICKS) while one of them is on; open any other look by id and it steps through all of them.
import type { HudSkin } from "./skin.ts";

const found = import.meta.glob<{ skin: HudSkin }>("./skins/*.ts", { eager: true });
export const SKINS: HudSkin[] = Object.keys(found).sort().map((k) => found[k]!.skin);
const byId = new Map(SKINS.map((s) => [s.id, s]));
/** The owner's round-2 picks from #3246 (0, 8 and 19), then the looks that combine them. */
const PICK_IDS = ["classic", "case-file", "sketchbook", "case-sketch", "classic-file", "classic-sketch", "field-notes"];
export const PICKS: HudSkin[] = PICK_IDS.flatMap((id) => byId.get(id) ?? []);

const asked = new URLSearchParams(location.search).get("hud");
/** True when the page was opened with ?hud=, so the chooser shows. */
export const choosing = asked !== null;
let current: HudSkin = byId.get(asked ?? "") ?? byId.get("classic") ?? SKINS[0]!;
const styled = new Set<string>();

export const skinNow = () => current;
export function useSkin(id: string): HudSkin | null {
  const s = byId.get(id) ?? SKINS[Number(id)];
  if (!s) return null;
  current = s;
  if (choosing) { const u = new URL(location.href); u.searchParams.set("hud", s.id); history.replaceState(null, "", u); }
  return s;
}
/** The looks the chip steps through from the one showing: the picks, or every look when it's off the list. */
export const ring = () => (PICKS.includes(current) ? PICKS : SKINS);
export function stepSkin(by: number) {
  const r = ring();
  return useSkin(r[(r.indexOf(current) + by + r.length) % r.length]!.id);
}

/** Put the skin's CSS on the page (once) and tag the HUD with it. */
export function dress(root: HTMLElement) {
  if (!styled.has(current.id)) {
    const st = document.createElement("style"); st.dataset.hud = current.id; st.textContent = current.css;
    document.head.append(st); styled.add(current.id);
  }
  if (root.dataset.skin !== current.id) root.dataset.skin = current.id;
}
