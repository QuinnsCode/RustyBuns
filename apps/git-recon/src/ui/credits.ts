// The credits on the page (src/sim/credits.ts has the scenes): the briefing file the strips are typed onto, and the
// polaroids that drop onto the table round it. Each polaroid is a photograph of the engine: the outtake is staged on
// the film set's game, the world drawn from where the take left the camera, and the canvas cropped square.
import type * as THREE from "three";
import type { Frame } from "@rustybuns/util/director";
import { OUTTAKES, stageOuttake, type OuttakeId, type Setup } from "../sim/credits.ts";
import type { Stage } from "../sim/director.ts";
import type { Game } from "../sim/game.ts";
import type { World } from "./scene.ts";

/** The props a scene draws when none are out: nothing over the level. */
const BARE: Stage = { bars: 0, daze: 0, caption: null, title: null, prompt: null, shot: null, heli: null, gun: null, craft: null, ladder: null, boat: null };

/** The film lot: a level's game and its world, drawn by the page's renderer. */
export interface Lot { game: Game; world: World }

/** Stages outtake `id` on the set and draws it from the take's camera (left on the camera for the frame after). */
export function frameOuttake(set: Lot, id: OuttakeId, camera: THREE.PerspectiveCamera): Setup {
  const st = stageOuttake(set.game, id);
  // The figures ease into their poses: a few draws settle them.
  for (let i = 0; i < 8; i++) set.world.sync(set.game, 0.25);
  set.world.stage({ ...BARE, ...st.props }, set.game.time, 0);
  aim(camera, st);
  return st;
}
export function aim(camera: THREE.PerspectiveCamera, st: Setup) {
  camera.position.set(st.cam.from.x, st.cam.from.y, st.cam.from.z);
  camera.lookAt(st.cam.at.x, st.cam.at.y, st.cam.at.z);
  camera.fov = 50;
  camera.updateProjectionMatrix();
}

/**
 * Every outtake, photographed: each drawn on a square canvas, as a JPEG data URL, by outtake id. The renderer is left
 * square, so the page sizes it back to the window afterwards.
 */
export function photograph(set: Lot, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): Map<string, string> {
  const out = new Map<string, string>(), side = 360;
  renderer.setSize(side, side, false);
  camera.aspect = 1;
  for (const o of OUTTAKES) {
    frameOuttake(set, o.id, camera);
    renderer.render(set.world.scene, camera);
    // Read straight after the draw, while the buffer still holds it.
    out.set(o.id, renderer.domElement.toDataURL("image/jpeg", 0.82));
  }
  return out;
}

const typed = (text: string, since: number) => text.slice(0, Math.max(0, Math.floor(since * 26)));

/** The credits' table and file, over everything; `draw` puts one director frame on it. */
export function mountCredits() {
  const root = Object.assign(document.createElement("section"), { id: "credits", className: "credits", hidden: true });
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `<div class="file"><div class="card"><i class="clip" aria-hidden="true"></i><div class="lines"></div></div></div>
    <div class="photos" aria-hidden="true"></div><p class="skip">Any key to skip</p>`;
  document.body.append(root);
  const lines = root.querySelector<HTMLElement>(".lines")!, photos = root.querySelector<HTMLElement>(".photos")!;
  let shown = "";
  return {
    root,
    draw(f: Frame, pics: Map<string, string>) {
      root.hidden = f.scene?.id !== "credits";
      if (root.hidden) return;
      root.style.setProperty("--out", f.out.toFixed(3));
      // The strips, typed a letter at a time; a heading sprayed on; the stamp slammed down.
      const html = f.cards.map(({ card, in: k, since }) => card.kind === "strip"
        ? `<p class="strip${card.sub ? ` ${card.sub}` : ""}">${typed(card.text, since)}${typed(card.text, since).length < card.text.length ? "<i class=\"caret\"></i>" : ""}</p>`
        : `<p class="${card.kind ?? "head"}" style="--in:${k.toFixed(3)}">${card.text}</p>`).join("");
      if (html !== shown) lines.innerHTML = shown = html;
      // The polaroids, one per outtake dropped so far, falling into place.
      for (const { photo, drop, n } of f.photos) {
        let el = photos.querySelector<HTMLElement>(`[data-id="${photo.id}"]`);
        if (!el) {
          el = Object.assign(document.createElement("figure"), { className: "polaroid" });
          el.dataset.id = photo.id;
          el.dataset.n = String(n);
          el.innerHTML = `<img alt="" src="${pics.get(photo.id) ?? ""}"><figcaption>${photo.caption}</figcaption><i class="clip"></i>`;
          photos.append(el);
        }
        el.style.setProperty("--drop", drop.toFixed(3));
      }
      for (const el of photos.querySelectorAll<HTMLElement>(".polaroid")) if (!f.photos.some((p) => p.photo.id === el.dataset.id)) el.remove();
    },
    hide() { root.hidden = true; lines.innerHTML = shown = ""; photos.innerHTML = ""; },
  };
}
