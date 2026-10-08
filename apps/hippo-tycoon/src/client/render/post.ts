// A little cinema on top: bloom for the gold and the torchlight, then a hard teal-and-pink
// grade with fringe, a vignette and grain. The "film look" (fringe, grain, scanline,
// vignette) is one uniform so the options can turn it off; the grade itself stays.
// Bloom can be switched off for the low quality preset.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const Grade = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 }, film: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float film; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float ca = 0.0022 * dot(d, d) * 4.0 * film;                                 // colour fringe toward the edges, like cheap 80s glass
      vec3 c = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c += vec3(0.02, 0.07, 0.10) * (1.0 - smoothstep(0.0, 0.45, l)) * 0.8;   // teal in the shadows
      c *= mix(vec3(1.0), vec3(1.10, 0.93, 0.90), smoothstep(0.35, 0.95, l)); // warm pink-orange in the lights
      c = (c - 0.5) * 1.14 + 0.5;                                              // harder contrast
      c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.08);
      float v = smoothstep(1.12, 0.2, length(d * vec2(1.2, 1.0)));
      c *= mix(mix(1.0, 0.45, film), 1.0, v);                                  // the vignette
      c += (hash(vUv * 900.0 + time) - 0.5) * 0.04 * film;                          // film grain
      c *= 1.0 - film * (0.015 - 0.015 * sin(vUv.y * 900.0));                                // the faintest scanline
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class Post {
  private composer: EffectComposer;
  private grade: ShaderPass;
  private bloom: UnrealBloomPass;

  constructor(private gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(gl, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.75, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());            // tone mapping + sRGB
    this.grade = new ShaderPass(Grade);
    this.composer.addPass(this.grade);
  }

  resize(w: number, h: number) { this.composer.setSize(w, h); this.bloom.setSize(w, h); }

  /** Film look on or off (fringe, grain, scanline, vignette), and bloom on or off. */
  configure(o: { film: boolean; bloom: boolean }) { this.grade.uniforms.film!.value = o.film ? 1 : 0; this.bloom.enabled = o.bloom; }

  render(t: number) {
    this.grade.uniforms.time!.value = t % 100;
    this.composer.render();
  }
}
