// A real venue drawn round the room (#5933): the Gaussian splat ShareSplat hosts for a captured place, placed by the
// studio's `venue` (its scale, middle and turn). Spark is loaded only when a room has one, so every other room's page
// stays as small as it was. The jam room and the builder's 3D view each keep one, and `show` swaps it when the room's
// venue changes (the same file is not fetched twice).
import * as THREE from "three";
import { groundMap, type HeightMap } from "@rustybuns/gear";
import type { Venue } from "./room.ts";

type Spark = typeof import("@sparkjsdev/spark");
let spark: Promise<Spark> | null = null;

/** Whether the venue is in: none, on its way, drawn (with its points), or why it could not be read. */
export type VenueState = { state: "none" } | { state: "loading"; src: string } | { state: "drawn"; src: string; points: number } | { state: "failed"; src: string; why: string };

export class VenueSplat {
  private mesh: import("@sparkjsdev/spark").SplatMesh | null = null;
  private src = "";
  private renderer: import("@sparkjsdev/spark").SparkRenderer | null = null;
  state: VenueState = { state: "none" };
  /** Called whenever the state changes (the builder's panel says when a capture is in or would not load). */
  onChange: (s: VenueState) => void = () => {};
  /** Called once a capture that came without its ground's heights is in, with the heights read off its points. */
  onLand: (src: string, land: HeightMap) => void = () => {};
  private put(s: VenueState) { this.state = s; this.onChange(s); }
  constructor(private scene: THREE.Scene, private gl: THREE.WebGLRenderer) {}

  /** Draw `venue` (or take the drawn one away when there is none). */
  async show(venue: Venue | undefined): Promise<VenueState> {
    if (!venue) { this.drop(); return this.state; }
    if (venue.src !== this.src) {
      this.drop();
      this.src = venue.src;
      this.put({ state: "loading", src: venue.src });
      try {
        const { SparkRenderer, SplatMesh } = await (spark ??= import("@sparkjsdev/spark"));
        if (!this.renderer) { this.renderer = new SparkRenderer({ renderer: this.gl }); this.scene.add(this.renderer); }
        const m = new SplatMesh({ url: venue.src });
        await m.initialized;
        if (this.src !== venue.src) { m.dispose(); return this.state; } // another venue came in while this one loaded
        this.mesh = m;
        this.scene.add(m);
        this.put({ state: "drawn", src: venue.src, points: m.packedSplats?.numSplats ?? 0 });
        if (!venue.land) { const land = groundOf(m); if (land) this.onLand(venue.src, land); }
      } catch (e) {
        if (this.src === venue.src) this.put({ state: "failed", src: venue.src, why: e instanceof Error ? e.message : String(e) });
        return this.state;
      }
    }
    if (this.mesh) place(this.mesh, venue);
    return this.state;
  }

  private drop() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.mesh = null; this.src = ""; this.put({ state: "none" });
  }
}

/** The capture's ground (@rustybuns/gear groundMap), stood up as `place` stands it (y-down, so x stays, y and z flip):
 *  only the splats solid enough to be something. */
function groundOf(m: import("@sparkjsdev/spark").SplatMesh): HeightMap | null {
  const xyz: number[] = [];
  m.forEachSplat((_i, c, _s, _q, opacity) => { if (opacity > 0.3) xyz.push(c.x, -c.y, -c.z); });
  return groundMap(xyz);
}

/** Capture tools write y-down, as ShareSplat's viewer turns them: half a turn about x stands it up, then the venue's turn. */
function place(m: THREE.Object3D, v: Venue) {
  const up = new THREE.Quaternion(1, 0, 0, 0), turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw);
  m.quaternion.copy(turn.multiply(up));
  m.position.set(...v.at);
  m.scale.setScalar(v.scale);
}
