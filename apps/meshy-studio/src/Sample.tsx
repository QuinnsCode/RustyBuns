// The first screen's example, no key needed: a drawing beside a 3D model you can turn, so a newcomer sees
// what the app makes before they get a Meshy key. The pair is from the repo (public/sample), not from Meshy:
// a public-domain engraving and the jackalope Mythic Masters built in Blender. Swap in a real Meshy pair here.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const DRAWING = "/sample/jackalope-drawing.jpg";
const MODEL = "/sample/jackalope.glb";

/** For a probe or a test: whether the model is in, and which way it faces (radians). */
export interface SampleState { loaded: boolean; error: string | null; turn: number }
declare global { interface Window { meshySample?: { state: () => SampleState } } }

export function Sample() {
  return (
    <section className="sample plate" aria-label="An example">
      <h2>See what it makes</h2>
      <div className="pair">
        <figure>
          <img src={DRAWING} alt="An old drawing of a jackalope, a hare with antlers" width={213} height={176} />
          <figcaption>A picture goes in</figcaption>
        </figure>
        <span className="arrow" aria-hidden>→</span>
        <figure>
          <Spinner />
          <figcaption>A 3D model comes out. Drag to turn it.</figcaption>
        </figure>
      </div>
      <p className="muted small">An example to look at: the drawing is public domain, and this model was made for one of our games, not by Meshy. Add a key below to turn your own pictures into models.</p>
    </section>
  );
}

function Spinner() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const state: SampleState = { loaded: false, error: null, turn: 0 };
    window.meshySample = { state: () => ({ ...state }) };

    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { state.error = "no WebGL"; return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a221c, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(2, 3, 2.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    const pivot = new THREE.Group();
    scene.add(pivot);

    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h || 1;
      camera.updateProjectionMatrix();
    };
    const sizes = new ResizeObserver(fit);
    sizes.observe(el);
    fit();

    new GLTFLoader().load(MODEL, (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3()), mid = bounds.getCenter(new THREE.Vector3());
      model.position.sub(mid);
      pivot.add(model);
      const r = Math.max(size.x, size.y, size.z);
      camera.position.set(0, r * 0.35, r * 2.1);
      camera.lookAt(0, 0, 0);
      state.loaded = true;
    }, undefined, (e) => { state.error = String((e as Error)?.message ?? e); });

    // Turns on its own until someone drags it; a drag turns it by hand.
    let dragging = false, lastX = 0, raf = 0, prev = performance.now();
    let touched = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const down = (e: PointerEvent) => { dragging = touched = true; lastX = e.clientX; try { el.setPointerCapture(e.pointerId); } catch {} };
    const move = (e: PointerEvent) => { if (!dragging) return; state.turn += (e.clientX - lastX) * 0.012; lastX = e.clientX; };
    const up = () => { dragging = false; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    const frame = (now: number) => {
      if (!touched) state.turn += Math.min(now - prev, 50) * 0.0006;
      prev = now;
      pivot.rotation.y = state.turn;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      sizes.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      if (window.meshySample?.state) delete window.meshySample;
    };
  }, []);
  return <div ref={box} className="spinner" role="img" aria-label="A 3D jackalope model, turning" />;
}
