// The planet's skin: land from Natural Earth's country shapes, and sea that reads as water. The sea is deep
// blue in open ocean and turquoise over the coastal shelves, ripples with a few travelling swells, throws a
// sun glint and picks up the sky's colour at grazing angles. Land stays dark so the outlines and the course
// read on top of it.
import * as THREE from "three";
import type { Country, Position } from "./countries.ts";

const W = 2048, H = 1024; // equirectangular land mask: lon -180..180 across, lat 90..-90 down

/** A ring's points with the date-line jumps taken out, so it draws as one shape (and a pole-circling one closes over its pole). */
export function unwrap(ring: Position[]): Position[] {
  const out: Position[] = [];
  let shift = 0, prev = ring[0]![0]!;
  for (const [lon, lat] of ring) {
    const d = lon! + shift - prev;
    if (d > 180) shift -= 360; else if (d < -180) shift += 360;
    prev = lon! + shift;
    out.push([prev, lat!]);
  }
  const span = out[out.length - 1]![0]! - out[0]![0]!;
  if (Math.abs(span) > 180) {
    const pole = out.reduce((s, p) => s + p[1]!, 0) < 0 ? -90 : 90;
    out.push([out[out.length - 1]![0]!, pole], [out[0]![0]!, pole]);
  }
  return out;
}

/** White land on black sea: sharp for the coastline, blurred for how near the shore (the shelf) a bit of sea is. */
function landCanvas(list: Country[], blur: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  if (blur) g.filter = `blur(${blur}px)`;
  g.fillStyle = "#fff";
  for (const country of list) {
    g.beginPath();
    for (const ring of country.rings) {
      const pts = unwrap(ring);
      for (const off of [-360, 0, 360]) pts.forEach(([lon, lat], k) => {
        const x = ((lon! + off + 180) / 360) * W, y = ((90 - lat!) / 180) * H;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      });
    }
    g.fill("evenodd");
  }
  return c;
}

function texture(c: HTMLCanvasElement | null): THREE.Texture {
  const t = c ? new THREE.CanvasTexture(c) : new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t.minFilter = THREE.LinearFilter; // no mipmaps: the longitude seam would pick a blurry level and draw a line
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const vertex = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldPos;
void main() {
  vObj = position;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragment = /* glsl */ `
uniform sampler2D land;
uniform sampler2D shelf;
uniform vec3 sunDir;
uniform float time;
uniform float near; // 1 with the camera down at the water (a swim), 0 from orbit: the fine chop only shows close up
uniform mat4 modelMatrix; // three declares it for the vertex stage only
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldPos;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Swell height: travelling sine swells plus drifting noise chop, over the unit sphere.
float sea(vec3 p) {
  float h = 0.0;
  h += 0.50 * sin(dot(p, vec3(0.8, 0.3, -0.5)) * 90.0 - time * 1.3);
  h += 0.35 * sin(dot(p, vec3(-0.4, 0.7, 0.6)) * 130.0 - time * 1.7);
  h += 0.25 * sin(dot(p, vec3(0.2, -0.9, 0.4)) * 210.0 - time * 2.3);
  h += 0.9 * noise(p * 60.0 + vec3(time * 0.15, 0.0, time * 0.1));
  h += 0.45 * noise(p * 180.0 - vec3(0.0, time * 0.3, time * 0.2));
  h += 0.25 * near * noise(p * 600.0 + vec3(time * 0.7, time * 0.4, 0.0));
  return h;
}

void main() {
  vec3 p = normalize(vObj);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(-p.z, p.x);
  vec2 uv = vec2(lon / 6.283185307 + 0.5, lat / 3.141592654 + 0.5);
  float isLand = smoothstep(0.35, 0.65, texture2D(land, uv).r);
  float nearShore = texture2D(shelf, uv).r;

  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(sunDir);
  float diff = max(dot(N, L), 0.0);

  // Land: dark (these are linear colours; the output is sRGB), a touch warmer towards the equator, lit gently.
  vec3 landCol = mix(vec3(0.012, 0.018, 0.017), vec3(0.02, 0.022, 0.014), cos(lat));
  landCol *= 0.6 + 0.9 * diff;

  // Sea: ripple the normal by the swell's slope (finite differences along two tangents).
  vec3 t1 = normalize(cross(abs(p.y) < 0.99 ? vec3(0,1,0) : vec3(1,0,0), p));
  vec3 t2 = cross(p, t1);
  float e = 0.0015;
  float h0 = sea(p);
  float dx = (sea(normalize(p + t1 * e)) - h0) / e;
  float dy = (sea(normalize(p + t2 * e)) - h0) / e;
  // The ripples grow as the camera comes down to the water and fade from orbit, so the planet doesn't shimmer.
  float dist = length(cameraPosition - vWorldPos);
  float rough = mix(0.0022, 0.0004, smoothstep(0.3, 3.0, dist));
  vec3 objN = normalize(p - (t1 * dx + t2 * dy) * rough);
  vec3 Ns = normalize(mat3(modelMatrix) * objN);

  float shelfAmt = smoothstep(0.02, 0.6, nearShore);
  vec3 abyss = vec3(0.002, 0.01, 0.035);
  vec3 open = vec3(0.004, 0.035, 0.1);
  vec3 shallow = vec3(0.012, 0.15, 0.17);
  vec3 water = mix(mix(abyss, open, 0.5 + 0.5 * diff), shallow, shelfAmt * 0.8);
  water *= 0.45 + 0.75 * max(dot(Ns, L), 0.0);
  water *= mix(1.0, 0.7 + 0.6 * smoothstep(-0.4, 2.2, h0), 0.3 + 0.7 * near); // lighter crests, darker troughs

  float fres = pow(1.0 - max(dot(Ns, V), 0.0), 4.0);
  vec3 sky = vec3(0.08, 0.22, 0.42);
  water = mix(water, sky * (0.3 + 0.7 * diff), fres * 0.75);

  vec3 Hv = normalize(L + V);
  float nh = max(dot(Ns, Hv), 0.0);
  float glint = pow(nh, 320.0) * 0.55 + pow(nh, 40.0) * 0.09;
  water += vec3(1.0, 0.95, 0.85) * glint * step(0.0, dot(N, L));
  // Surf: a pale fringe where the water meets the shore.
  water += vec3(0.12, 0.25, 0.28) * smoothstep(0.45, 0.75, nearShore) * (0.1 + 0.2 * noise(p * 300.0 + time * 0.4));

  gl_FragColor = vec4(mix(water, landCol, isLand), 1.0);
  #include <colorspace_fragment>
}`;

export class PlanetSkin {
  readonly material: THREE.ShaderMaterial;
  constructor(sunDir: THREE.Vector3) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        land: { value: texture(null) },
        shelf: { value: texture(null) },
        sunDir: { value: sunDir.clone().normalize() },
        time: { value: 0 },
        near: { value: 0 },
      },
    });
  }
  setLand(list: Country[]) {
    const u = this.material.uniforms;
    u.land!.value.dispose(); u.shelf!.value.dispose();
    u.land!.value = texture(landCanvas(list, 0));
    u.shelf!.value = texture(landCanvas(list, 10));
  }
  /** Time on, and how far the camera is from the planet's centre. */
  tick(dt: number, camDist: number) {
    const u = this.material.uniforms;
    u.time!.value += dt;
    u.near!.value = Math.min(1, Math.max(0, (2.4 - camDist) / 0.9));
  }
}
