// Your soldier on the menu: the same clay figure the battlefield draws (figure.ts, through a one-figure Crowd), in
// your build and head, standing on a moulded olive base and turning slowly, like a toy on the box's window. It only
// renders while the menu shows, and redraws when you pick another build or head.
import * as THREE from "three";
import { buildFigure, createCrowd, pose, setHead, type BuildId, type Figure } from "./figure.ts";
import { buildHead, type HeadDef } from "./heads.ts";

const INK = 0x1f1f1f, GLOSS = 0.22, TURN = 0.45; // rad/s

export function mountPortrait(canvas: HTMLCanvasElement, showing: () => boolean) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6dc, 0x3d4229, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd9e6a8, 1.2);
  rim.position.set(2, 2, -3);
  scene.add(rim);
  // The moulded base: a squat olive disc with a bevelled lip.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0x5d6b35, roughness: 0.45 }));
  base.position.y = -0.04;
  scene.add(base);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
  cam.position.set(0, 1.25, 4.4);
  cam.lookAt(0, 0.9, 0);
  const crowd = createCrowd();
  scene.add(crowd.root);
  let fig: Figure | null = null, last = 0, raf = 0;

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    return true;
  }
  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    if (!fig || !showing() || !size()) { last = t; return; }
    const dt = Math.min(0.1, (t - (last || t)) / 1000);
    last = t;
    fig.root.rotation.y += dt * TURN;
    pose(fig, { pose: "stand", speed: 0, dt, roll: 0, pitch: 0 });
    crowd.update();
    r.render(scene, cam);
  }
  return {
    /** Stand this build, with this head, on the base. */
    show(build: BuildId, head: HeadDef) {
      const yaw = fig?.root.rotation.y ?? -0.5;
      if (fig) scene.remove(fig.root), crowd.remove(fig);
      fig = buildFigure(INK, GLOSS, build);
      setHead(fig, buildHead(head, fig.root.userData.mat, fig.head.userData.size));
      fig.root.rotation.y = yaw;
      scene.add(fig.root);
      crowd.add(fig);
      if (!raf) raf = requestAnimationFrame(frame);
    },
  };
}
