// Your camper on a turntable, for the lobby's customizer.

import * as THREE from "three";
import type { Look } from "../hunt/game.ts";
import { makeCharacter } from "./characters.ts";

export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private char: THREE.Group | null = null;
  private key = "";

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight("#fff6e6", "#4a3a2a", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), new THREE.MeshStandardMaterial({ color: "#7c8f55" }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.camera.position.set(0, 1.4, 4.6);
    this.camera.lookAt(0, 1.0, 0);
  }

  render(look: Look, t: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const key = JSON.stringify(look);
    if (key !== this.key) {
      if (this.char) this.scene.remove(this.char);
      const ch = makeCharacter("camper", look, "");
      ch.tag.visible = false;
      this.char = ch.root;
      this.scene.add(ch.root);
      this.key = key;
    }
    if (this.char) this.char.rotation.y = t * 0.0008;
    this.renderer.render(this.scene, this.camera);
  }
}
