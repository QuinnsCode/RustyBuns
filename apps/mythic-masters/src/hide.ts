// What a hide is made of, up close: fur strands and clumps, overlapping scales, pebbled hide or wrinkled skin,
// as a few lines of GLSL bumped into the beast's patched material (beasts.ts `stylize`). Like the field looks
// (effects.ts) it runs in the model's rest-pose space, so there are no UVs or textures and the pattern stays
// stuck to the body; the bump fades out where it would go below a pixel, so a beast far off or in the gallery
// doesn't shimmer. One noise lookup or a 2x2x2 cell search a pixel keeps it inside a phone's frame budget.

export type Surface = "fur" | "scale" | "hide" | "skin";

const FUR = /fur|mane|hair|shag|ruff|whisker|plume|fluff/;
const SCALE = /scale|scute|plate|snake/;
const SKIN = /^skin$|wart|blotch/;
const HARD = /horn|claw|spike|tooth|teeth|beak|talon|tusk|fang|bone|hoof|nail|iron|steel|gold|eye|pearl|shell|plastron|flame|ember|glow|core|spark|wand|cloth|robe|suit|chain/;

/** What the whole beast is covered in, from its materials' names: a furred beast's belly is fur too. */
export function surfaceOf(names: readonly string[]): Surface {
  if (names.some((n) => FUR.test(n) && !/mane|hair|plume|whisker/.test(n)) || names.filter((n) => FUR.test(n)).length > 1) return "fur";
  if (names.some((n) => SCALE.test(n))) return "scale";
  if (names.some((n) => SKIN.test(n))) return "skin";
  return "hide";
}

/** The detail one material wears: a mane is fur on any beast, a horn or a claw stays smooth. */
export function surfaceFor(name: string, beast: Surface): Surface | null {
  if (HARD.test(name)) return null;
  if (FUR.test(name)) return "fur";
  if (SCALE.test(name)) return "scale";
  if (/wing|fin|web|flipper/.test(name)) return beast === "fur" ? "skin" : beast === "scale" ? "hide" : beast;
  return beast;
}

/** Each pattern: `h` 0..1 at point `p` (rest pose, the model about 1 tall), its frequency, how deep the bump,
 * how much the colour darkens in its grooves and how far the raised tips lighten toward white (sheen). */
const PATTERN: Record<Surface, { freq: number; bump: number; tone: number; tip: number; h: string }> = {
  fur: { freq: 20, bump: 0.03, tone: 0.2, tip: 0.35, h: "h = 0.62 * hdNoise( p * vec3( 1.0, 0.22, 1.0 ) ) + 0.38 * hdNoise( p * 0.33 + 7.1 );" },
  scale: { freq: 13, bump: 0.045, tone: 0.28, tip: 0.2, h: "float d = hdCell( p ); h = 1.0 - smoothstep( 0.05, 0.62, d );" },
  hide: { freq: 16, bump: 0.022, tone: 0.1, tip: 0.1, h: "h = 0.6 * hdNoise( p ) + 0.4 * hdNoise( p * 2.3 + 3.1 ); h = smoothstep( 0.2, 0.8, h );" },
  skin: { freq: 9, bump: 0.025, tone: 0.12, tip: 0.1, h: "h = 1.0 - abs( 2.0 * hdNoise( p ) - 1.0 ); h = 0.7 * h * h + 0.3 * hdNoise( p * 3.7 );" },
};

const HELPERS = `
float hdHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float hdNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( hdHash( i ), hdHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( hdHash( i + vec3( 0, 1, 0 ) ), hdHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( hdHash( i + vec3( 0, 0, 1 ) ), hdHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( hdHash( i + vec3( 0, 1, 1 ) ), hdHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// distance to the nearest cell centre, centres jittered a quarter cell so the 8 nearest cells are enough
float hdCell( vec3 x ) {
  vec3 b = floor( x - 0.5 ); float d = 9.0;
  for ( int k = 0; k < 8; k++ ) {
    vec3 c = b + vec3( float( k & 1 ), float( ( k >> 1 ) & 1 ), float( ( k >> 2 ) & 1 ) );
    vec3 j = vec3( hdHash( c ), hdHash( c + 31.7 ), hdHash( c + 57.3 ) ) - 0.5;
    d = min( d, length( x - c - 0.5 - j * 0.5 ) );
  }
  return d;
}
vec3 hdPerturb( vec3 pos, vec3 n, vec2 dH, float side ) {
  vec3 sx = dFdx( pos ), sy = dFdy( pos ), r1 = cross( sy, n ), r2 = cross( n, sx );
  float det = dot( sx, r1 ) * side;
  vec3 g = sign( det ) * ( dH.x * r1 + dH.y * r2 );
  return normalize( abs( det ) * n - g );
}
`;

/** The GLSL a material splices in: `vert` after begin_vertex, `frag` after normal_fragment_maps (it bends
 * `normal` and darkens `diffuseColor` before the lights read them). `vHideP` is the rest-pose position. */
export function hideDetail(s: Surface) {
  const p = PATTERN[s];
  return {
    key: `hide-${s}`,
    vert: "vHideP = position;",
    pars: `varying vec3 vHideP;\n${HELPERS}`,
    frag: `{
      vec3 p = vHideP * ${p.freq.toFixed(1)}; float h = 0.0;
      ${p.h}
      float fade = 1.0 - smoothstep( 0.3, 0.8, length( fwidth( p ) ) );
      normal = hdPerturb( - vViewPosition, normal, vec2( dFdx( h ), dFdy( h ) ) * ${p.bump.toFixed(3)} * fade, faceDirection );
      diffuseColor.rgb *= 1.0 - ${p.tone.toFixed(2)} * ( 1.0 - h ) * fade;
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.6 + 0.4, ${p.tip.toFixed(2)} * h * h * fade );
    }`,
  };
}
