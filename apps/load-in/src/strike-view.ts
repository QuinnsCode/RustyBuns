// The load-out on the page: the truck parked outside (bed, walls, roof and cab, open at the back), and once the
// load-out starts a card with what's left to pack, what will slide, the cable being coiled, and the tally when the door
// comes down. The curfew itself shows in the clock (dial-view.ts).
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { coiling, loopsFor, type Cables } from "./cables/cables.ts";
import type { Truck, World } from "./sim.ts";
import { strikeState } from "./strike.ts";

/** The truck as boxes: floor, two sides, bulkhead and roof, open where the back faces the venue, the cab past the bulkhead. */
export function truckMesh(t: Truck): THREE.Group {
  const g = new THREE.Group(), w = t.x1 - t.x0, d = t.z1 - t.z0, cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, k = 0.06;
  const body = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.8 }), bed = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.95 });
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  box(w, 0.02, d, cx, 0.005, cz, bed);
  box(k, t.h, d, t.x0 - k / 2, t.h / 2, cz, body);
  box(k, t.h, d, t.x1 + k / 2, t.h / 2, cz, body);
  box(w + 2 * k, t.h, k, cx, t.h / 2, t.z1 + k / 2, body);
  box(w + 2 * k, k, d, cx, t.h + k / 2, cz, body);
  box(w + 2 * k, t.h * 0.7, 1.6, cx, t.h * 0.35, t.z1 + k + 0.8, new THREE.MeshStandardMaterial({ color: 0x3d6f9e, roughness: 0.6 }));
  return g;
}

/** The load-out card; `update` each frame (hidden until the load-out starts). */
export function mountStrike(parent: HTMLElement) {
  const card = document.createElement("div");
  card.className = "bar-card strike-card";
  card.hidden = true;
  parent.appendChild(card);
  const list = (keys: readonly string[]) => esc(keys.join(", "));
  return {
    update(w: World, c: Cables) {
      const s = strikeState(w, c);
      card.hidden = !s;
      if (!s) return;
      const coil = coiling(c);
      if (s.tally) {
        const t = s.tally;
        card.innerHTML = `<b>Truck shut</b><span>Took ${Math.round(t.took / 60)} min${t.late ? `, ${Math.ceil(t.late / 60)} min past curfew` : ""}</span>`
          + `<span class="${t.fine ? "warn" : "pass"}">${t.fine ? `Fined $${t.fine}` : "Out before curfew"}</span>`
          + `<span class="${t.sliding.length ? "warn" : "pass"}">${t.sliding.length ? `Slid on the drive: ${list(t.sliding)}` : "Nothing slid"}</span>`
          + (t.crushing.length ? `<span class="warn">Crushed: ${list(t.crushing.map((x) => x.under))}</span>` : "")
          + `<span class="${t.twists ? "warn" : "pass"}">${t.twists ? `${t.twists} twists to work out next show` : "Every cable coiled flat"}</span>`;
        return;
      }
      card.innerHTML = `<b>Load out</b>`
        + (s.cables.length ? `<span>Cables out: ${list(s.cables)}</span>` : `<span class="pass">Every cable in its case</span>`)
        + (s.out.length ? `<span>To pack: ${list(s.out)}</span>` : `<span class="pass">Everything's in the truck</span>`)
        + (s.sliding.length ? `<span class="warn">Will slide: ${list(s.sliding)}</span>` : "")
        + (s.crushing.length ? `<span class="warn">Too heavy on top: ${list(s.crushing.map((x) => x.top))}</span>` : "")
        + (coil?.coiling ? `<span>Coiling ${esc(coil.key)}: ${coil.coiling.ways.length} of ${loopsFor(coil)}</span>` : "")
        + (s.twists ? `<span class="warn">${s.twists} twists coiled in</span>` : "")
        + `<small>F at the case to coil, Q over, E under; pack front to back; T shut the truck</small>`;
    },
  };
}
