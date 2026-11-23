// Campers, rangers and Bigfoot: each is a human() from @rustybuns/models, a skinned body grown from a build, dressed
// and coloured from the player's Look. A camper wears a puffer jacket, trousers and boots, their hair (short, curly or
// long, as the Look's colours decide) and a hat or a pack if they picked one; a ranger wears the campaign hat, a
// tucked-in shirt with a reflective band, a duty belt, and carries a flashlight; Bigfoot is the biggest build there
// is, in fur, barefoot. They walk on planted feet (the model's IK gait), so a stride matches the ground they cover.

import * as THREE from "three";
import { BUILDS, human, type Build, type Human, type HairStyle, type Outfit, type Palette } from "@rustybuns/models/human";
import { BODIES, PANTS, SHIRTS, SKINS, type Look } from "../hunt/game.ts";
import type { Role } from "../hunt/sim.ts";

export interface Character {
  root: THREE.Group;
  /** The head's bone: it turns with the pitch, and carries the flashlight's light. */
  head: THREE.Object3D;
  body: Human;
  light: THREE.SpotLight | null;
  beam: THREE.Mesh | null;
  tag: THREE.Sprite;
  role: Role;
  /** Which way it last travelled, from the way it faces (radians), and where it stood last frame. */
  heading: number;
  last: THREE.Vector3 | null;
}

const HAIR = ["#2a1b12", "#4f3220", "#7b4f28", "#b98a4a", "#171717", "#8f3a1c"];
const HAIR_STYLES: HairStyle[] = ["short", "curly", "long"];
const RANGER_SHIRT = "#b8a275";
const RANGER_PANTS = "#4c5b3a";
/** Bigfoot: 2.45 m of him, broad, heavy, long in the arm and short in the leg. */
const BIGFOOT: Build = { height: 2.45, frame: 1, mass: 0.9, muscle: 1, belly: 0.3, bust: 0, legs: -0.5, arms: 1 };

const shade = (color: string, f: number) => `#${new THREE.Color(color).multiplyScalar(f).getHexString()}`;
const mix = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;

/** What a Look is built like: the body it picked. */
export const buildOf = (look: Look): Build => BUILDS[BODIES[look.body] ?? "average"];

/** What a Look wears, as the model takes it. */
export function outfitOf(ranger: boolean, look: Look): Outfit {
  const hair = HAIR_STYLES[(look.skin + look.pants * 2 + look.shirt) % HAIR_STYLES.length]!;
  return ranger ? { top: "shirt", hair, hat: "campaign", belt: true, stripe: true, torch: true }
    : { top: "puffer", hair, hat: look.hat, pack: look.pack };
}

/** Each slot's colour for a Look. */
function colors(ranger: boolean, look: Look): Palette {
  const top = ranger ? RANGER_SHIRT : SHIRTS[look.shirt]!, bottom = ranger ? RANGER_PANTS : PANTS[look.pants]!;
  const skin = SKINS[look.skin]!, hair = HAIR[(look.skin * 3 + look.shirt) % HAIR.length]!;
  const hat = ranger ? "#8a6a3e" : SHIRTS[(look.shirt + 5) % SHIRTS.length]!, pack = SHIRTS[(look.shirt + 3) % SHIRTS.length]!;
  const boot = ranger ? "#2c2018" : "#5a3b24";
  return {
    skin, lips: mix(skin, "#8a2f2f", 0.45), hair, brow: shade(hair, 0.8), iris: "#1b1712", eyeWhite: "#f1ede4",
    top, topDark: shade(top, 0.66), trim: ranger ? "#d8ff3a" : "#f2efe6", bottom, bottomDark: shade(bottom, 0.75),
    boot, bootDark: shade(boot, 0.7), sole: "#1d1611", hat, hatDark: shade(hat, 0.7), band: "#3b2a1a",
    pack, packDark: shade(pack, 0.6), strap: shade(pack, 0.45), roll: "#5a6b3a", belt: "#3b2a1a", kit: "#1e2226", metal: "#c9a646", glow: "#fff8e0",
  };
}

/** A number from a name, so two players in the same clothes don't walk in step. */
const seedOf = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) + 1; };

export function makeCharacter(role: Role, look: Look, name: string): Character {
  const ranger = role === "ranger";
  const body = human(buildOf(look), outfitOf(ranger, look), colors(ranger, look), seedOf(name));
  const head = body.bones.head;

  // The flashlight: a real spotlight and a faint cone, on the head so they follow the ranger's gaze.
  let light: THREE.SpotLight | null = null, beam: THREE.Mesh | null = null;
  if (ranger) {
    light = new THREE.SpotLight("#fff4d6", 0, 46, (26 * Math.PI) / 180, 0.45, 1.2);
    light.position.set(-0.2, 0, 0.2);
    light.target.position.set(-0.2, -0.25, 10);
    head.add(light, light.target);
    const beamGeo = new THREE.ConeGeometry(Math.tan((26 * Math.PI) / 180) * 22, 22, 24, 1, true);
    beamGeo.translate(0, -11, 0);
    beamGeo.rotateX(-Math.PI / 2);
    beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#fff2c4", transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(-0.2, -0.1, 0.2);
    beam.visible = false;
    head.add(beam);
  }

  const tag = nameTag(name, ranger ? "#e8c547" : "#ffffff");
  body.root.add(tag);
  const ch: Character = { root: body.root, head, body, light, beam, tag, role, heading: 0, last: null };
  pose(ch, 0, false, 0, 0);
  return ch;
}

export function nameTag(text: string, color: string): THREE.Sprite {
  if (typeof document === "undefined") return new THREE.Sprite(); // tests: no canvas to draw on
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 30px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillStyle = "rgba(20, 16, 10, 0.6)";
  g.beginPath(); g.roundRect(128 - w / 2, 10, w, 44, 12); g.fill();
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * Pose for one frame: the walk from its speed and the way it travels (`ch.heading`), a crouch, the head's pitch, and
 * sat on the ground once caught. A ranger holds the flashlight out where they look.
 */
export function pose(ch: Character, speed: number, crouch: boolean, pitch: number, dt: number, caught = false) {
  ch.body.pose({ speed, heading: ch.heading, crouch, pitch, aim: ch.role === "ranger", down: caught }, dt);
  ch.tag.position.y = ch.body.headAt.y + 0.42;
}

/** Bigfoot: a person's bones (so pose() crouches and walks him), in fur, with a bare dark face and eyes that catch the light. */
export function makeBigfoot(): Character {
  const body = human(BIGFOOT, { top: "fur", hair: "bald", hat: "none", barefoot: true }, { top: "#4a3423", bootDark: "#2a1e17", glow: "#f2c14e" }, 7);
  const tag = nameTag("Bigfoot", "#ffb27a");
  tag.visible = false;
  body.root.add(tag);
  const ch: Character = { root: body.root, head: body.bones.head, body, light: null, beam: null, tag, role: "camper", heading: 0, last: null };
  pose(ch, 0, true, 0, 0);
  return ch;
}
