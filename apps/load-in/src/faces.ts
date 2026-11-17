// Gear you can read from across the room: a perforated steel grille on the speakers, a woven cloth front on the guitar
// cab, a badge of our own (RUSTY) where a real maker puts theirs, stencils on the road cases (the cable case says
// CABLES) and a jack panel that lights up, each socket ringed and named, when you look at it or aim a cable at it.
// View only: the sim never reads it. The models (@rustybuns/models/gear) have no UVs, so the grille and cloth are
// drawn in the shader from each mesh's own coordinates.
import * as THREE from "three";
import type { GearLook } from "@rustybuns/models/gear";

/** A grille's weave, drawn in its own metres: "steel" is round holes on a 7 mm grid, "cloth" a basket weave. */
function patterned(m: THREE.MeshStandardMaterial, kind: "steel" | "cloth") {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;\nvObjN = normal;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;")
      .replace("#include <color_fragment>", `#include <color_fragment>
      {
        vec3 an = abs(vObjN);
        vec2 uv = an.x > an.y && an.x > an.z ? vObjPos.zy : an.y > an.z ? vObjPos.xz : vObjPos.xy;
        ${kind === "steel" ? `
        vec2 cell = uv / 0.007;
        cell.x += 0.5 * mod(floor(cell.y), 2.0);
        float r = length(fract(cell) - 0.5);
        float w = fwidth(cell.x);
        float hole = 1.0 - smoothstep(0.3 - w, 0.3 + w, r);
        float far = smoothstep(0.25, 0.7, w);
        diffuseColor.rgb *= mix(1.0 - hole * 0.85, 0.72, far);` : `
        vec2 cell = uv / 0.006;
        vec2 f = fract(cell);
        float across = mod(floor(cell.x) + floor(cell.y), 2.0);
        float thread = across > 0.5 ? sin(f.x * 3.14159) : sin(f.y * 3.14159);
        float w = fwidth(cell.x);
        float far = smoothstep(0.3, 0.8, w);
        diffuseColor.rgb *= mix(0.55 + 0.6 * thread, 0.85, far);`}
      }`);
  };
  m.customProgramCacheKey = () => `load-in-grille-${kind}`;
}

/** The materials a dressed model uses on top of the app's `look`: the grille gets its holes, the cab its cloth. */
export function faceLook(look: GearLook) {
  if (look.grille instanceof THREE.MeshStandardMaterial) patterned(look.grille, "steel");
  const cloth = new THREE.MeshStandardMaterial({ color: 0xa89878, roughness: 0.95 });
  patterned(cloth, "cloth");
  const panelLit = (look.panel as THREE.MeshStandardMaterial).clone();
  panelLit.emissive.setHex(0x3a4a5c);
  panelLit.emissiveIntensity = 0.9;
  return { cloth, panelLit, panel: look.panel };
}
export type FaceLook = ReturnType<typeof faceLook>;

/** What a jack's printed name says on the panel: `xlr-in-3` -> XLR IN 3, `speaker-out-1` -> SPK OUT 1. */
export function jackLabel(id: string): string {
  return id.replace(/^speaker/, "spk").replace(/^inst-in$/, "input").split("-").join(" ").toUpperCase();
}

const textures = new Map<string, THREE.CanvasTexture>();
/** Text on a transparent card, cached by everything that changes it. */
function textTexture(text: string, style: "badge" | "stencil" | "label" | "script"): THREE.CanvasTexture {
  const key = `${style}:${text}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas"), x = c.getContext("2d")!;
  const [W, H] = style === "stencil" ? [512, 128] : style === "label" ? [256, 64] : [256, 96];
  c.width = W; c.height = H;
  x.textAlign = "center";
  x.textBaseline = "middle";
  if (style === "badge") {
    // Our own maker's badge: a brushed plate, the name in bold caps, an orange underline.
    x.fillStyle = "#c9ccd1";
    x.beginPath(); x.roundRect(4, 4, W - 8, H - 8, 14); x.fill();
    x.fillStyle = "#16181b";
    x.beginPath(); x.roundRect(10, 10, W - 20, H - 20, 10); x.fill();
    x.fillStyle = "#f2f2f2";
    x.font = "900 50px system-ui, sans-serif";
    x.fillText(text, W / 2, H / 2 - 6);
    x.fillStyle = "#f07a1a";
    x.fillRect(W * 0.22, H - 26, W * 0.56, 6);
  } else if (style === "script") {
    x.fillStyle = "#efe4c8";
    x.font = "italic 800 64px Georgia, serif";
    x.fillText(text, W / 2, H / 2);
  } else if (style === "stencil") {
    x.fillStyle = "#f1efe6";
    x.font = "900 92px 'Arial Black', Impact, sans-serif";
    x.fillText(text, W / 2, H / 2 + 4);
  } else {
    // A jack's name: white on a dark tag, so it reads on any panel.
    x.fillStyle = "rgba(10, 14, 20, 0.85)";
    x.beginPath(); x.roundRect(2, 6, W - 4, H - 12, 10); x.fill();
    x.fillStyle = "#ffffff";
    x.font = `800 ${text.length > 9 ? 34 : 42}px system-ui, sans-serif`;
    x.fillText(text, W / 2, H / 2 + 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

const card = (text: string, style: Parameters<typeof textTexture>[1], width: number, opacity = 1) => {
  const t = textTexture(text, style), img = t.image as HTMLCanvasElement;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, (width * img.height) / img.width),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity, roughness: style === "badge" ? 0.35 : 0.8, metalness: style === "badge" ? 0.4 : 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  return m;
};

type Mark = { text: string; style: Parameters<typeof textTexture>[1]; width: number; at: THREE.Vector3Tuple; tilt?: number; turn?: number };

/** Where a real maker would put a badge (or a crew its stencil), per model: a point on the face and the face's turn. */
function marks(id: string, size: number[], stencil?: string): Mark[] {
  const [w, h, d] = size;
  switch (id) {
    case "top-12-powered": case "top-15-passive":
      return [{ text: "RUSTY", style: "badge", width: w * 0.32, at: [w * 0.22, h * 0.14, d / 2 + 0.006] }];
    case "sub-18":
      return [{ text: "RUSTY", style: "badge", width: 0.13, at: [0, h * 0.12, d / 2 + 0.006] }];
    case "line-array-box":
      return [{ text: "RUSTY", style: "badge", width: 0.13, at: [0, h * 0.15, d / 2 + 0.006] }];
    case "wedge-12": {
      // On the slope, low down where the singer's feet would cover it.
      const lo = 0.08, backTop = -d / 2 + 0.07, dz = backTop - d / 2, dy = h - lo, len = Math.hypot(dz, dy), t = 0.2, out = 0.012;
      return [{ text: "RUSTY", style: "badge", width: 0.13, at: [w * 0.3, lo + dy * t + (-dz / len) * out, d / 2 + dz * t + (dy / len) * out], tilt: Math.atan2(-dz, dy) - Math.PI / 2 }];
    }
    case "cab-4x12":
      return [{ text: "Rusty", style: "script", width: 0.2, at: [-w * 0.28, h * 0.84, d / 2 + 0.002] }];
    case "amp-head":
      return [{ text: "Rusty", style: "script", width: 0.16, at: [0, h * 0.62, (d - 0.03) / 2 + 0.002] }];
    case "amp-rack-4u":
      return [{ text: "RUSTY", style: "badge", width: 0.1, at: [w * 0.33, 0.3, d / 2 - 0.009] }];
    case "mixer-small":
      return [{ text: "RUSTY", style: "badge", width: 0.07, at: [0, 0.024, d / 2 + 0.002] }];
    case "road-case-m": {
      const word = stencil ?? "BACKLINE", y = 0.075 + (h - 0.075) * 0.35;
      return [
        { text: word, style: "stencil", width: w * 0.7, at: [0, y, d / 2 + 0.002] },
        { text: word, style: "stencil", width: w * 0.7, at: [0, y, -d / 2 - 0.002], turn: Math.PI },
      ];
    }
    case "distro-box":
      return [{ text: "DISTRO", style: "stencil", width: w * 0.7, at: [0, h * 0.75, d / 2 + 0.004] }];
    case "generator-7kva":
      return [{ text: "7 kVA", style: "stencil", width: 0.22, at: [0, h * 0.55, d / 2 + 0.004] }];
    default:
      return [];
  }
}

export type Dressed = { lit(on: boolean, jack?: string): void };

/**
 * Dress one model: its badge or stencil, the cab's cloth, and the jack rings and names (hidden until `lit`). A model's
 * jacks are its `jack:<id>` children (+z out of the panel).
 */
export function dress(model: THREE.Object3D, f: FaceLook, opts: { stencil?: string } = {}): Dressed {
  const id = String(model.userData.gear ?? ""), size: number[] = model.userData.size ?? [0, 0, 0];
  if (id === "cab-4x12") for (const c of model.children) if (c.name === "cab-4x12-grille" && c instanceof THREE.Mesh) c.material = f.cloth;
  for (const m of marks(id, size, opts.stencil)) {
    const c = card(m.text, m.style, m.width);
    c.position.set(...m.at);
    c.rotation.set(m.tilt ?? 0, m.turn ?? 0, 0, "YXZ");
    model.add(c);
  }
  const panels = model.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.endsWith("-panel"));
  const rings = new THREE.Group();
  rings.visible = false;
  const ringGeo = new THREE.RingGeometry(0.016, 0.021, 18);
  const byJack = new Map<string, THREE.MeshBasicMaterial>();
  const sockets = model.children.filter((c) => c.name.startsWith("jack:"));
  // A crowded panel (a mixer's 8 inputs side by side) prints its names as small as the gap between sockets.
  const gap = Math.min(0.1, ...sockets.flatMap((a) => sockets.filter((b) => b !== a).map((b) => a.position.distanceTo(b.position) * 0.95)));
  for (const j of sockets) {
    const name = j.name.slice(5), glow = new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.85, depthWrite: false });
    byJack.set(name, glow);
    // Upright on its panel ("up" is up, or toward the back on a panel facing up), its name printed above it.
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(j.quaternion), up = Math.abs(out.y) > 0.7 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const across = up.clone().cross(out).normalize(), q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, out.clone().cross(across), out));
    const ring = new THREE.Mesh(ringGeo, glow);
    ring.position.copy(j.position).addScaledVector(out, 0.003);
    ring.quaternion.copy(q);
    ring.scale.setScalar(Math.min(1, gap / 0.045));
    rings.add(ring);
    const label = card(jackLabel(name), "label", gap);
    label.quaternion.copy(q);
    label.position.copy(j.position).addScaledVector(out, 0.003).add(new THREE.Vector3(0, 0.026 * Math.min(1, gap / 0.045) + gap * 0.125, 0).applyQuaternion(q));
    rings.add(label);
  }
  model.add(rings);
  let was: string | null = null;
  return {
    lit(on, jack) {
      const now = on ? jack ?? "" : null;
      if (now === was) return;
      was = now;
      rings.visible = on;
      for (const p of panels) p.material = on ? f.panelLit : f.panel;
      for (const [name, m] of byJack) m.color.setHex(name === jack ? 0xffc04d : 0x7fd6ff);
    },
  };
}
