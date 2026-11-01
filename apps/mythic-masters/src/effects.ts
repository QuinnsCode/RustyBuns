// One look per field. Every beast that carries a field wears that field's procedural effect, so a type reads at a
// glance: ember cracks glow, tide is wet, frost sparkles. Each look is a few lines of GLSL run in the beast's
// patched material (beasts.ts `stylize`), in object space scaled by the beast's height, so there are no UVs and no
// textures and the pattern stays stuck to the body as it moves. Adding a field is one row of FIELD_LOOK.
import type { Field } from "./fields.ts";

/** Seconds, shared by every beast material (Puppet.update advances it once a frame). */
export const FX_TIME = { value: 0 };

/** How loud a beast's look is, by how rare it is: the commons wear it faintly, the legends and mythics in full. */
export const FX_AMOUNT: Record<string, number> = { common: 0.3, uncommon: 0.4, rare: 0.6, event: 0.7, legendary: 0.95, mythic: 1.15, unknown: 0.3 };

/**
 * A look edits four things, all in the lit pass: `D` multiplies the diffuse light (colour breakup), `S` adds sheen
 * to the specular, `E` adds light the surface gives off. Inputs: `p` the point on the body (1.0 = the beast's
 * height), `t` seconds, `rim` 0 face-on to 1 edge-on, `wN` the world normal, `up` 0 at the feet to 1 at the head.
 */
export const FIELD_LOOK: Record<Field, string> = {
  ember: `
    float cr = 1.0 - smoothstep( 0.0, 0.11, abs( fxFbm( p * 3.5 ) - 0.5 ) );
    float pulse = 0.55 + 0.45 * sin( t * 2.4 + p.y * 7.0 + fxNoise( p * 3.0 ) * 6.0 );
    E += vec3( 1.0, 0.42, 0.08 ) * cr * pulse * 1.8;
    vec3 q = p * 9.0 + vec3( 0.0, -t * 1.2, 0.0 ); vec3 id = floor( q );
    float sp = step( 0.9, fxHash( id ) ) * ( 1.0 - smoothstep( 0.1, 0.32, length( fract( q ) - 0.5 ) ) );
    E += vec3( 1.0, 0.7, 0.2 ) * sp * 2.2;
    D *= vec3( 1.06, 0.97, 0.92 );`,
  tide: `
    float band = smoothstep( 0.8, 1.0, sin( p.y * 9.0 - t * 1.6 + fxNoise( p * 4.0 ) * 4.0 ) );
    S += vec3( 0.55, 0.85, 1.0 ) * ( pow( rim, 1.5 ) * 0.9 + band * 0.7 );
    float dr = smoothstep( 0.7, 0.8, fxNoise( vec3( p.x * 9.0, p.y * 2.0 + t * 0.9, p.z * 9.0 ) ) );
    E += vec3( 0.2, 0.55, 0.8 ) * dr * 0.7;
    D *= vec3( 0.93, 0.98, 1.05 );`,
  gale: `
    float ang = atan( p.z, p.x );
    float sw = sin( ang * 5.0 + p.y * 9.0 - t * 3.0 + fxNoise( p * 3.0 ) * 3.0 );
    E += vec3( 0.8, 0.95, 0.9 ) * smoothstep( 0.86, 1.0, sw ) * 0.28;
    S += vec3( 0.7, 0.9, 0.85 ) * pow( rim, 3.0 ) * 0.3;`,
  stone: `
    float cr = 1.0 - smoothstep( 0.0, 0.045, abs( fxFbm( p * 4.5 ) - 0.5 ) );
    D *= ( 1.0 - 0.55 * cr ) * ( 0.88 + 0.24 * fxNoise( p * 34.0 ) );
    S += vec3( 0.55, 0.5, 0.42 ) * pow( rim, 2.0 ) * 0.22 * ( 1.0 - up * 0.3 );`,
  frost: `
    S += vec3( 0.6, 0.85, 1.0 ) * pow( rim, 1.5 ) * 1.1;
    E += vec3( 0.3, 0.4, 0.55 ) * pow( rim, 3.0 );
    vec3 id = floor( p * 24.0 ); float h = fxHash( id );
    E += vec3( 0.9, 0.97, 1.0 ) * step( 0.94, h ) * ( 0.5 + 0.5 * sin( t * 4.0 + h * 60.0 ) ) * 2.2;
    D *= mix( vec3( 1.0 ), vec3( 0.85, 0.97, 1.15 ), 0.8 );`,
  storm: `
    float flick = step( 0.45, fxHash( vec3( floor( t * 9.0 ), 1.0, 2.0 ) ) );
    float arc = 1.0 - smoothstep( 0.0, 0.03, abs( fxFbm( p * 4.5 + vec3( 0.0, 0.0, floor( t * 9.0 ) * 3.1 ) ) - 0.5 ) );
    E += vec3( 0.7, 0.8, 1.0 ) * arc * flick * 2.4;
    E += vec3( 0.3, 0.35, 0.7 ) * pow( rim, 3.0 ) * ( 0.5 + 0.5 * flick );`,
  grove: `
    float lf = smoothstep( 0.62, 0.68, fxNoise( p * 20.0 ) );
    D = mix( D, vec3( 0.65, 1.0, 0.55 ), lf * 0.45 * ( 0.4 + 0.6 * ( wN.y * 0.5 + 0.5 ) ) );
    E += vec3( 0.05, 0.14, 0.03 ) * lf;`,
  venom: `
    D *= mix( vec3( 1.0 ), vec3( 0.88, 1.05, 0.8 ), 0.8 );
    float dr = smoothstep( 0.72, 0.82, fxNoise( vec3( p.x * 8.0, p.y * 2.0 + t * 0.6, p.z * 8.0 ) ) );
    E += vec3( 0.4, 0.95, 0.1 ) * dr * 0.8;
    vec3 q = p * 7.0 + vec3( 0.0, -t * 0.5, 0.0 ); vec3 id = floor( q );
    float bub = step( 0.8, fxHash( id ) ) * smoothstep( 0.07, 0.0, abs( length( fract( q ) - 0.5 ) - 0.22 ) );
    E += vec3( 0.6, 1.0, 0.25 ) * bub * 1.6;`,
  spirit: `
    float fl = 0.5 + 0.5 * sin( t * 3.0 + p.y * 6.0 + fxNoise( p * 4.0 ) * 5.0 );
    D *= 0.82 + 0.18 * fl;
    E += vec3( 0.45, 0.7, 1.0 ) * ( 0.06 + 0.12 * fl + pow( rim, 2.0 ) * 0.55 );`,
  shadow: `
    float wp = fxFbm( p * 4.0 + vec3( 0.0, -t * 0.4, 0.0 ) );
    D *= 1.0 - 0.38 * smoothstep( 0.4, 0.7, wp );
    E += vec3( 0.22, 0.05, 0.38 ) * pow( rim, 1.6 ) * ( 0.4 + 0.9 * wp );
    S *= 0.6;`,
  iron: `
    float st = fxNoise( vec3( p.x * 70.0, p.y * 2.5, p.z * 70.0 ) );
    D *= 0.88 + 0.24 * st;
    S += vec3( 0.75, 0.8, 0.9 ) * pow( st, 3.0 ) * 0.4 + vec3( 0.5, 0.55, 0.65 ) * pow( rim, 2.0 ) * 0.2;`,
  wild: `
    float fur = fxNoise( p * 46.0 );
    D *= 0.8 + 0.4 * fur;
    E += col * pow( rim, 2.0 ) * 0.22 * fur;`,
};

const HELPERS = `
float fxHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float fxNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( fxHash( i ), fxHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( fxHash( i + vec3( 0, 1, 0 ) ), fxHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( fxHash( i + vec3( 0, 0, 1 ) ), fxHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( fxHash( i + vec3( 0, 1, 1 ) ), fxHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float fxFbm( vec3 p ) { return fxNoise( p ) * 0.6 + fxNoise( p * 2.1 ) * 0.4; }
`;

export interface FieldLook { key: string; helpers: string; frag: string }
const made = new Map<string, FieldLook>();

/** The shader pieces for a beast's fields (null for none); one program per distinct set of fields. */
export function fieldLook(fields: readonly Field[]): FieldLook | null {
  const set = [...new Set(fields)].filter((f) => f in FIELD_LOOK).sort();
  if (!set.length) return null;
  const key = set.join("+");
  let look = made.get(key);
  if (!look) {
    // two fields share the effort: each look is dialled to ~60% so a dual beast doesn't glare
    const k = set.length > 1 ? 0.6 : 1;
    const frag = `{
      vec3 p = vFxPos; float t = uFxTime; float up = vBeastY;
      vec3 wN2 = inverseTransformDirection( normal, viewMatrix ); vec3 wN = wN2;
      float rim = 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) );
      vec3 col = diffuseColor.rgb;
      vec3 D = vec3( 1.0 ), S = vec3( 0.0 ), E = vec3( 0.0 );
      ${set.map((f) => `{ ${FIELD_LOOK[f]} }`).join("\n")}
      float a = uFxAmt * ${k.toFixed(2)};
      D = mix( vec3( 1.0 ), D, a );
      reflectedLight.directDiffuse *= D; reflectedLight.indirectDiffuse *= D;
      reflectedLight.indirectSpecular += S * a;
      totalEmissiveRadiance += E * a;
    }`;
    look = { key, helpers: HELPERS, frag };
    made.set(key, look);
  }
  return look;
}
