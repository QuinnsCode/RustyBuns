// The 3D view: the model, its skin, the skeleton, and a handle on every tip.
// Click a handle to drag it; shift-click a second one to clasp them together.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { RigResult } from "../rig/analyze.ts";
import type { Model } from "./model.ts";
import { IkRig } from "./ik.ts";

export interface StageState {
  tips: { index: number; pinned: boolean; label: string }[];
  selected: number | null; // a tip index, 0 for the root
  rootPinned: boolean;
  clasped: [number, number] | null;
}

const ROOT = 0;
const TIP = 0xff7a45, TIP_FREE = 0x8a8f98, TIP_SELECTED = 0xffd166, ROOT_COLOR = 0x5ec8ff;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private proxy = new THREE.Object3D();
  private content = new THREE.Group();
  private handles = new THREE.Group();
  private helper: THREE.SkeletonHelper | null = null;
  private bones: THREE.Bone[] = [];
  private skinned: THREE.SkinnedMesh[] = [];
  private weightColors: THREE.BufferAttribute[] = [];
  private ik: IkRig | null = null;
  private selected: number | null = null;
  private dragging = false;
  private settle = 0;
  private raf = 0;
  private resize: ResizeObserver;
  view = { weights: false, skeleton: true };
  onState: (s: StageState) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x15171b);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const grid = new THREE.GridHelper(4, 20, 0x3a3f48, 0x262a31);
    this.scene.add(grid, this.content, this.handles, this.proxy);
    this.camera.position.set(1.6, 1.4, 2.6);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.7, 0);
    this.orbit.enableDamping = true;
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.7);
    this.gizmo.addEventListener("dragging-changed", (e) => { this.dragging = !!e.value; this.orbit.enabled = !e.value; });
    this.gizmo.addEventListener("objectChange", () => this.moveSelected());
    this.scene.add(this.gizmo.getHelper());
    this.renderer.domElement.addEventListener("pointerdown", (e) => this.pick(e));
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private fit() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Show a model as it came in, no rig yet. */
  setModel(m: Model) {
    this.clear();
    for (const p of m.parts) this.content.add(new THREE.Mesh(p.geometry, p.material));
    this.emit();
  }

  private clear() {
    this.gizmo.detach();
    this.selected = null;
    this.content.clear();
    this.handles.clear();
    if (this.helper) { this.scene.remove(this.helper); this.helper.dispose(); this.helper = null; }
    this.bones = []; this.skinned = []; this.weightColors = [];
    this.ik = null;
  }

  /** Skin the model to a found skeleton and hand the skeleton to the IK solver. */
  setRig(m: Model, rig: RigResult) {
    this.clear();
    const { joints, parents } = rig;
    const J = parents.length;
    for (let j = 0; j < J; j++) {
      const b = new THREE.Bone();
      b.name = `joint_${j}`;
      const p = parents[j];
      if (p < 0) b.position.set(joints[0], joints[1], joints[2]);
      else b.position.set(joints[j * 3] - joints[p * 3], joints[j * 3 + 1] - joints[p * 3 + 1], joints[j * 3 + 2] - joints[p * 3 + 2]);
      this.bones.push(b);
      if (p >= 0) this.bones[p].add(b);
    }
    this.content.add(this.bones[0]);
    this.content.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    const palette = Array.from({ length: J }, (_, j) => new THREE.Color().setHSL((j * 0.618034) % 1, 0.7, 0.55));
    for (const part of m.parts) {
      const g = part.geometry;
      const idx = rig.skinIndex.slice(part.start * 4, (part.start + part.count) * 4);
      const w = rig.skinWeight.slice(part.start * 4, (part.start + part.count) * 4);
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
      const col = new Float32Array(part.count * 3);
      for (let v = 0; v < part.count; v++) for (let k = 0; k < 4; k++) {
        const c = palette[idx[v * 4 + k]], wt = w[v * 4 + k];
        col[v * 3] += c.r * wt; col[v * 3 + 1] += c.g * wt; col[v * 3 + 2] += c.b * wt;
      }
      this.weightColors.push(new THREE.Float32BufferAttribute(col, 3));
      const sm = new THREE.SkinnedMesh(g, part.material);
      sm.bind(skeleton, new THREE.Matrix4());
      sm.frustumCulled = false;
      sm.userData.material = part.material;
      sm.userData.original = g.getAttribute("color") ?? null;
      this.content.add(sm);
      this.skinned.push(sm);
    }
    this.helper = new THREE.SkeletonHelper(this.bones[0]);
    const hm = this.helper.material as THREE.LineBasicMaterial;
    hm.depthTest = false; hm.transparent = true; hm.linewidth = 2;
    this.helper.renderOrder = 10;
    this.scene.add(this.helper);

    this.ik = new IkRig(joints, parents);
    const sphere = new THREE.SphereGeometry(0.028, 16, 12), cube = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    for (const t of [ROOT, ...this.ik.tips]) {
      const mat = new THREE.MeshBasicMaterial({ color: t === ROOT ? ROOT_COLOR : TIP, depthTest: false, transparent: true });
      const h = new THREE.Mesh(t === ROOT ? cube : sphere, mat);
      h.renderOrder = 11;
      h.userData.joint = t;
      this.handles.add(h);
    }
    this.applyView();
    this.syncBones();
    this.emit();
  }

  setView(v: Partial<Stage["view"]>) { Object.assign(this.view, v); this.applyView(); }

  private applyView() {
    this.skinned.forEach((sm, i) => {
      if (this.view.weights) {
        sm.geometry.setAttribute("color", this.weightColors[i]);
        sm.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
      } else {
        if (sm.userData.original) sm.geometry.setAttribute("color", sm.userData.original);
        else sm.geometry.deleteAttribute("color");
        sm.material = sm.userData.material;
      }
    });
    if (this.helper) this.helper.visible = this.view.skeleton;
    this.handles.visible = this.view.skeleton || this.selected !== null;
  }

  private pick(e: PointerEvent) {
    if (!this.ik || e.button !== 0 || this.gizmo.dragging) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.handles.children, false)[0];
    if (!hit) return;
    const j = hit.object.userData.joint as number;
    if (e.shiftKey && this.selected !== null && this.selected !== ROOT && j !== ROOT && j !== this.selected) {
      this.clasp(this.selected, j);
      return;
    }
    this.select(j);
  }

  select(j: number | null) {
    if (!this.ik) return;
    this.selected = j;
    if (j === null) { this.gizmo.detach(); this.emit(); return; }
    if (j === ROOT) this.ik.setRootPinned(true);
    else if (!this.ik.goals.has(j)) this.ik.setPinned(j, true);
    const p = j === ROOT ? this.ik.rootGoalPosition()! : this.ik.goalPosition(j)!;
    this.proxy.position.set(p[0], p[1], p[2]);
    this.gizmo.attach(this.proxy);
    this.emit();
  }

  private moveSelected() {
    if (!this.ik || this.selected === null) return;
    const { x, y, z } = this.proxy.position;
    if (this.selected === ROOT) this.ik.moveRoot(x, y, z);
    else this.ik.moveGoal(this.selected, x, y, z);
    this.settle = 30;
  }

  setPinned(tip: number, on: boolean) {
    if (!this.ik) return;
    if (!on && this.selected === tip) this.select(null);
    this.ik.setPinned(tip, on);
    this.settle = 30;
    this.emit();
  }

  setRootPinned(on: boolean) {
    if (!this.ik) return;
    if (!on && this.selected === ROOT) this.select(null);
    this.ik.setRootPinned(on);
    this.settle = 30;
    this.emit();
  }

  clasp(a: number, b: number) {
    if (!this.ik) return;
    this.ik.clasp(a, b);
    this.select(a);
    this.settle = 120;
  }

  unclasp() { this.ik?.unclasp(); this.settle = 30; this.emit(); }

  resetPose() {
    if (!this.ik) return;
    this.ik.unclasp();
    this.ik.reset();
    if (this.selected !== null) this.select(this.selected);
    this.syncBones();
    this.emit();
  }

  private frame() {
    this.orbit.update();
    if (this.ik && (this.dragging || this.settle > 0)) {
      this.ik.solve();
      this.syncBones();
      if (this.settle > 0) this.settle--;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private m = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  private syncBones() {
    if (!this.ik) return;
    for (let j = 0; j < this.bones.length; j++) {
      const b = this.bones[j];
      this.m.fromArray(this.ik.matrixWorld(j) as number[]);
      const p = this.ik.parents[j];
      if (p >= 0) this.m.premultiply(this.inv.fromArray(this.ik.matrixWorld(p) as number[]).invert());
      this.m.decompose(b.position, b.quaternion, b.scale);
    }
    this.content.updateMatrixWorld(true);
    for (const h of this.handles.children) {
      const j = h.userData.joint as number;
      const free = j !== ROOT && !this.ik.goals.has(j);
      const g = j === ROOT ? this.ik.rootGoalPosition() : this.ik.goalPosition(j);
      const p = g ?? this.ik.worldPosition(j);
      h.position.set(p[0], p[1], p[2]);
      const c = j === this.selected ? TIP_SELECTED : j === ROOT ? ROOT_COLOR : free ? TIP_FREE : TIP;
      (h as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(c);
    }
  }

  private emit() {
    const ik = this.ik;
    if (!ik) { this.onState({ tips: [], selected: null, rootPinned: false, clasped: null }); return; }
    const root = ik.worldPosition(ROOT);
    this.onState({
      tips: ik.tips.map((t, i) => ({ index: t, pinned: ik.goals.has(t), label: `Tip ${i + 1} · ${describe(ik.worldPosition(t), root)}` })),
      selected: this.selected,
      rootPinned: ik.rootPinned,
      clasped: ik.clasped,
    });
  }

  async exportGlb(): Promise<ArrayBuffer> {
    const out = await new GLTFExporter().parseAsync(this.content, { binary: true });
    return out as ArrayBuffer;
  }
}

/** A rough name for where a tip is, relative to the root. */
function describe(p: number[], root: number[]): string {
  const dx = p[0] - root[0], dy = p[1] - root[1], dz = p[2] - root[2];
  const parts: string[] = [];
  if (Math.abs(dy) > 0.15) parts.push(dy > 0 ? "high" : "low");
  if (Math.abs(dx) > 0.15) parts.push(dx > 0 ? "right" : "left");
  if (Math.abs(dz) > 0.15) parts.push(dz > 0 ? "front" : "back");
  return parts.join(" ") || "center";
}
