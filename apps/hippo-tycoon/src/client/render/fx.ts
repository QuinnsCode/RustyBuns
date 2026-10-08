import * as THREE from "three";

const CAP = 600;

/** A soft round sprite, drawn rather than loaded. */
function dot(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d")!, grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, "#fff"); grad.addColorStop(0.6, "#fffa"); grad.addColorStop(1, "#fff0");
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** One Points object holds every particle; the rest is a little physics. */
export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(CAP * 3);
  private col = new Float32Array(CAP * 3);
  private vel = new Float32Array(CAP * 3);
  private life = new Float32Array(CAP);
  private max = new Float32Array(CAP);
  private grav = new Float32Array(CAP);
  private head = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.7, map: dot(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, alphaTest: 0.05 }));
    this.points.frustumCulled = false;
    for (let i = 0; i < CAP; i++) this.pos[i * 3 + 1] = -100;
  }

  emit(p: THREE.Vector3, color: number, n: number, speed: number, life = 0.7, grav = 6, up = 0.5) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % CAP;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([Math.cos(a) * s, Math.random() * speed * up + speed * 0.3, Math.sin(a) * s], i * 3);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6);
      this.grav[i] = grav;
    }
  }

  /** Drop every live particle (a skipped or restarted finale leaves no confetti hanging). */
  clear() { this.life.fill(0); for (let i = 0; i < CAP; i++) this.pos[i * 3 + 1] = -100; (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; }

  update(dt: number) {
    for (let i = 0; i < CAP; i++) {
      if (this.life[i]! <= 0) { this.pos[i * 3 + 1] = -100; continue; }
      this.life[i] = this.life[i]! - dt;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! - this.grav[i]! * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] = this.pos[i * 3 + k]! + this.vel[i * 3 + k]! * dt;
      const f = Math.max(0, this.life[i]! / this.max[i]!);
      for (let k = 0; k < 3; k++) this.col[i * 3 + k] = this.col[i * 3 + k]! * (0.2 + 0.8 * f) + 0.0001;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Floating text over the canvas ("+3!", "WATERED DOWN!"), projected from the pan. */
export class Popups {
  constructor(private host: HTMLElement) {}
  show(screen: { x: number; y: number }, text: string, color: string, big = false) {
    const el = document.createElement("div");
    el.className = "popup" + (big ? " big" : "");
    el.textContent = text; el.style.color = color;
    el.style.left = `${screen.x}px`; el.style.top = `${screen.y}px`;
    this.host.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
  clear() { for (const el of [...this.host.querySelectorAll(".popup")]) el.remove(); }
}
