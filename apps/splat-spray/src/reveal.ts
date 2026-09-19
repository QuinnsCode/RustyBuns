// Paint on the GPU. Each splat has a "painted at" time in a float texture,
// indexed by splat number. A Spark modifier reads it every frame:
// fresh paint flashes bright, holds, then dims to a faint memory.
// It dims by color, not opacity: captured surfaces are many overlapping
// splats, and many faint layers stack back up to solid.
// The CPU only writes the texture when you spray.
//
// Time is this effect's own uniform, set once per frame from Spark's onFrame
// hook (just before splats regenerate). Paint timestamps use the same clock.
// Not mesh.context.time: Spark writes its own timer there, a different clock.
import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

export const now = () => performance.now() / 1000;

export const FOCUS_DIM = 0.12;   // brightness of everything but the focused object

export const LOOK = {
  hold: 7,        // seconds fully visible
  fade: 8.0,      // seconds to fade
  memory: 0.22,   // brightness left in old dots
  flash: 1.6,     // extra brightness right after a hit
};

const NEVER = -1e6;
const ALWAYS = 1e8;   // "reveal all": negative age = stays visible, no flash
const WIDTH = 2048;

export class RevealField {
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  /** object id per splat, for focusing one object and dimming the rest */
  readonly itemTexture: THREE.DataTexture;
  readonly modifier: ReturnType<typeof makeModifier>;
  private readonly clock = new dyno.DynoFloat({ key: "paintNow", value: now() });
  private readonly focusItem = new dyno.DynoFloat({ key: "focusItem", value: -1 });
  private readonly focusOn = new dyno.DynoFloat({ key: "focusOn", value: 0 });
  painted = 0;

  constructor(readonly count: number, itemOf?: Int32Array) {
    const height = Math.max(1, Math.ceil(count / WIDTH));
    this.data = new Float32Array(WIDTH * height).fill(NEVER);
    this.texture = dataTexture(this.data, WIDTH, height);
    const items = new Float32Array(WIDTH * height).fill(-1);
    if (itemOf) for (let i = 0; i < count; i++) items[i] = itemOf[i]!;
    this.itemTexture = dataTexture(items, WIDTH, height);
    this.modifier = makeModifier(this.texture, this.itemTexture, this.clock, this.focusItem, this.focusOn);
  }

  /** Show one object at full brightness and dim everything else; -1 to stop. */
  focus(item: number) {
    this.focusItem.value = item;
    this.focusItem.uniform.value = item;
    this.focusOn.value = item >= 0 ? 1 : 0;
    this.focusOn.uniform.value = this.focusOn.value;
  }

  /** Paint every splat of one object, e.g. when it's been found. */
  paintObject(first: number, count: number, at = now()) {
    const range = new Uint32Array(count);
    for (let i = 0; i < count; i++) range[i] = first + i;
    this.paint(range, at);
  }

  /** Call from the mesh's onFrame hook: advances the clock the shader sees. */
  tick(t = now()) {
    this.clock.value = t;
    this.clock.uniform.value = t;
  }

  paint(indices: Uint32Array, at = now()) {
    for (const i of indices) {
      if (this.data[i] === NEVER) this.painted++;
      if (this.data[i] !== ALWAYS) this.data[i] = at;
    }
    this.texture.needsUpdate = true;
  }

  revealAll() {
    this.data.fill(ALWAYS, 0, this.count);
    this.painted = this.count;
    this.texture.needsUpdate = true;
  }

  reset() {
    this.data.fill(NEVER);
    this.painted = 0;
    this.texture.needsUpdate = true;
  }
}

function dataTexture(data: Float32Array, w: number, h: number) {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

type Uniform = InstanceType<typeof dyno.DynoFloat<string>>;

function makeModifier(texture: THREE.DataTexture, itemTexture: THREE.DataTexture, uTime: Uniform, uFocusItem: Uniform, uFocusOn: Uniform) {
  const { dynoBlock, dynoConst, splitGsplat, combineGsplat, combine, split, texelFetch,
    imod, div, sub, mul, add, mix, clamp, smoothstep, exp, abs, Gsplat, DynoSampler2D } = dyno;
  const uTex = new DynoSampler2D({ key: "paintTimes", value: texture });
  const uItems = new DynoSampler2D({ key: "splatItems", value: itemTexture });
  const f = (v: number) => dynoConst("float", v);

  return dynoBlock({ gsplat: Gsplat }, { gsplat: Gsplat }, ({ gsplat }) => {
    const g = splitGsplat(gsplat!).outputs;
    const w = dynoConst("int", WIDTH);
    const coord = combine({ vectorType: "ivec2", x: imod(g.index, w), y: div(g.index, w) });
    const t = split(texelFetch(uTex, coord)).outputs.r;
    const age = sub(uTime, t);
    const seen = clamp(add(t, f(1e5)), f(0), f(1));                            // 0 if never painted
    const fading = smoothstep(f(LOOK.hold), f(LOOK.hold + LOOK.fade), age);    // 0 fresh -> 1 old (negative age stays 0)
    const flash = mul(f(LOOK.flash), exp(mul(abs(age), f(-4))));
    let brightness = add(mix(f(1), f(LOOK.memory), fading), flash);
    // focus: the picked object stays lit, everything else dims
    const item = split(texelFetch(uItems, coord)).outputs.r;
    const isTarget = sub(f(1), clamp(abs(sub(item, uFocusItem)), f(0), f(1)));
    brightness = mul(brightness, mix(f(1), mix(f(FOCUS_DIM), f(1), isTarget), uFocusOn));
    return {
      gsplat: combineGsplat({ gsplat, opacity: mul(g.opacity, seen), rgb: mul(g.rgb, brightness) }),
    };
  });
}
