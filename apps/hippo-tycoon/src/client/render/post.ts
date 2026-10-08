// A little cinema on top: bloom for the gold and the gaslight, then a warm
// grade with a vignette and a touch of grain. Falls back to a plain render
// if the composer cannot be built (the game never depends on it).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const Grade = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 warm = mix(vec3(l) * vec3(1.05, 0.92, 0.78), c.rgb, 0.82);              // a pinch of sepia, mostly colour
      warm = mix(warm * vec3(0.92, 0.95, 1.06), warm * vec3(1.08, 1.0, 0.9), smoothstep(0.2, 0.8, l)); // cool shadows, warm lights
      float v = smoothstep(1.05, 0.25, length((vUv - 0.5) * vec2(1.15, 1.0)));
      warm *= mix(0.55, 1.0, v);
      warm += (hash(vUv * 900.0 + time) - 0.5) * 0.028;
      gl_FragColor = vec4(warm, c.a);
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.7, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());            // tone mapping + sRGB
    this.grade = new ShaderPass(Grade);
    this.composer.addPass(this.grade);
  }

  resize(w: number, h: number) { this.composer.setSize(w, h); this.bloom.setSize(w, h); }

  render(t: number) {
    this.grade.uniforms.time!.value = t % 100;
    this.composer.render();
  }
}
