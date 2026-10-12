// The trig the battle sims run on, the same to the last bit on every JS engine. The spec leaves
// Math.sin, Math.atan2, Math.hypot and friends to each engine, and they differ (Safari's aren't
// Chrome's), so a battle played in one browser could end differently when the campaign's Durable
// Object plays the hero's inputs again. These use only + - * / and Math.sqrt, which IEEE pins down,
// with fdlibm's polynomials: near enough to Math's for a game, and the same everywhere.

const PI = Math.PI;
const PIO2_HI = 1.57079632673412561417e+00; // pi/2's top 33 bits, so n * PIO2_HI is exact
const PIO2_LO = 6.07710050650619224932e-11; // the rest of pi/2
const TWO_OVER_PI = 6.36619772367581382433e-01;

// On [-pi/4, pi/4].
function kSin(x: number) {
  const z = x * x;
  const r = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)));
  return x + z * x * (-1.66666666666666324348e-01 + z * r);
}
function kCos(x: number) {
  const z = x * x;
  const r = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
  return 1 - (0.5 * z - z * r);
}

// x = n * pi/2 + r, |r| <= pi/4.
function reduce(x: number): [number, number] {
  const n = Math.round(x * TWO_OVER_PI);
  return [((n % 4) + 4) % 4, x - n * PIO2_HI - n * PIO2_LO];
}

export function sin(x: number) {
  const [q, r] = reduce(x);
  return q === 0 ? kSin(r) : q === 1 ? kCos(r) : q === 2 ? -kSin(r) : -kCos(r);
}

export function cos(x: number) {
  const [q, r] = reduce(x);
  return q === 0 ? kCos(r) : q === 1 ? -kSin(r) : q === 2 ? -kCos(r) : kSin(r);
}

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];

export function atan(x: number) {
  const neg = x < 0;
  let a = neg ? -x : x, id = -1;
  if (a > 7.378697629483821e19) return neg ? -ATAN_HI[3]! : ATAN_HI[3]!; // 2^66: as good as pi/2
  if (a >= 0.4375) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); }
    else if (a < 1.1875) { id = 1; a = (a - 1) / (a + 1); }
    else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); }
    else { id = 3; a = -1 / a; }
  }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  const r = id < 0 ? a - a * (s1 + s2) : ATAN_HI[id]! - ((a * (s1 + s2) - ATAN_LO[id]!) - a);
  return neg ? -r : r;
}

export function atan2(y: number, x: number) {
  if (x === 0) return y > 0 ? PI / 2 : y < 0 ? -PI / 2 : Object.is(x, -0) ? (Object.is(y, -0) ? -PI : PI) : y;
  if (y === 0) return x > 0 ? y : Object.is(y, -0) ? -PI : PI;
  const a = atan(Math.abs(y / x));
  return x > 0 ? (y > 0 ? a : -a) : y > 0 ? PI - a : a - PI;
}

export const acos = (x: number) => atan2(Math.sqrt((1 - x) * (1 + x)), x);

export const hypot = (x: number, y: number, z = 0) => Math.sqrt(x * x + y * y + z * z);
