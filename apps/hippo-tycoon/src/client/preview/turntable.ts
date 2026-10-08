// A turntable: one hippo (or all four in a row) at full size, slowly turning under
// studio light, so the costumes can be judged up close. Dev preview only.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HippoRig } from "../render/hippo.ts";
import type { Hippo } from "../../sim/types.ts";

export interface Pose { roar: boolean; snarl: boolean; sputter: boolean; sore: boolean; jaw: number; belt: boolean }
export const REST: Pose = { roar: false, snarl: false, sputter: false, sore: false, jaw: 0, belt: false };

export class Turntable {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private rigs = [0, 1, 2, 3].map((i) => new HippoRig(i));
  private stand = new THREE.Group();
  /** Which hippo, or -1 for all four side by side. */
  seat = 0;
  spin = true;
  angle = 0.5;
  pose: Pose = { ...REST };

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0x1b1726);
    this.scene.environment = new THREE.PMREMGenerator(this.gl).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    const key = new THREE.DirectionalLight(0xffe2c8, 2.6); key.position.set(-6, 10, -8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 10, bottom: -4 });
    const fill = new THREE.DirectionalLight(0x9ab8ff, 0.9); fill.position.set(8, 4, -4);
    const back = new THREE.DirectionalLight(0x39e6ff, 1.6); back.position.set(0, 6, 10);
    this.scene.add(new THREE.HemisphereLight(0xc8b8ff, 0x201a14, 0.6), key, fill, back);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    this.scene.add(this.stand);
    this.rigs.forEach((r) => this.stand.add(r.group));
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.gl.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  draw(now: number) {
    const t = now / 1000, all = this.seat < 0, p = this.pose;
    if (this.spin) this.angle = (this.angle + 0.006) % (Math.PI * 2);
    this.rigs.forEach((r, i) => {
      r.group.visible = all || i === this.seat;
      r.group.position.set(all ? (i - 1.5) * 5.2 : 0, 0, 0);
      r.group.rotation.set(0, Math.PI + this.angle, 0);                 // the rig faces -Z; start facing the camera
      r.setChampion(p.belt);
      const h: Hippo = { seat: i, slide: 0, gulp: -1, cooldown: 0, sputter: p.sputter ? 9 : 0, sore: p.sore ? 9 : 0, flooded: false, dud: false, score: 0, bellow: p.roar ? 9 : 0 };
      r.pose(h, 0, p.jaw, p.snarl ? 1 : 0, t);
    });
    const d = all ? 30 : 11.5, y = all ? 6.5 : 3.6;
    this.camera.position.set(0, y, d); this.camera.lookAt(0, all ? 1.7 : 2.1, 0);
    this.gl.render(this.scene, this.camera);
  }

  dispose() { this.gl.dispose(); this.gl.forceContextLoss(); }
}
