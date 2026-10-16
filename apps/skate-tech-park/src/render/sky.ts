// The air above the park: a dome that fades from a warm haze at the horizon to a clear blue overhead,
// and two rings of far ridges, each one hazier than the one before. The haze colour is the scene's
// fog colour, so the ground fades into the same colour the sky starts from.
import * as THREE from "three";

export const HAZE = 0xf2c49a;

export function sky(haze = HAZE) {
  const group = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { haze: { value: new THREE.Color(haze) }, zenith: { value: new THREE.Color(0x6f9fd8) }, sun: { value: new THREE.Vector3(-0.8, 0.25, -0.5).normalize() } },
      vertexShader: "varying vec3 v; void main() { v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 haze; uniform vec3 zenith; uniform vec3 sun; varying vec3 v;
        void main() {
          float up = clamp(v.y, 0.0, 1.0);
          vec3 c = mix(haze, zenith, pow(up, 0.55));
          c += vec3(1.0, 0.8, 0.5) * pow(max(dot(v, sun), 0.0), 24.0) * 0.5; // glow round the sun
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -2;
  group.add(dome);
  // Far ridges: jagged rings, nearest the darkest, each fading toward the haze.
  [[0.55, 0x8a8aa0, 0.0], [0.7, 0xa59aa5, 1.7]].forEach(([fade, color, phase], k) => {
    const n = 96, r = 0.9 - k * 0.03;
    const geo = new THREE.BufferGeometry(), pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const h = (a: number) => 0.035 + 0.03 * Math.abs(Math.sin(a * 5 + phase!) * Math.cos(a * 3 + phase! * 2)) + 0.012 * Math.sin(a * 23);
      pos.push(Math.sin(a0) * r, 0, Math.cos(a0) * r, Math.sin(a1) * r, 0, Math.cos(a1) * r, Math.sin(a0) * r, h(a0), Math.cos(a0) * r);
      pos.push(Math.sin(a1) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, h(a1), Math.cos(a1) * r, Math.sin(a0) * r, h(a0), Math.cos(a0) * r);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const ridge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color as number).lerp(new THREE.Color(haze), fade as number), side: THREE.DoubleSide, fog: false, depthWrite: false }));
    ridge.renderOrder = -1;
    group.add(ridge);
  });
  return group;
}

/** The dome is a unit sphere: scale it past the park and keep it centred on the camera. */
export function followCamera(g: THREE.Object3D, camera: THREE.Camera, radius = 900) {
  g.position.copy(camera.position);
  g.scale.setScalar(radius);
}
