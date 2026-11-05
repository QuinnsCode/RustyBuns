// Deterministic math for the fight sim and the bot: the same bits on every JS engine, in Rust native and in wasm
// (sim-rs/src/dmath.rs is this file line for line). `Math.sin`, `atan2`, `exp`, `pow` and `hypot` don't have to be
// exact in JS, and Rust calls the platform's libm, so one last bit can drift a whole fight apart (#3628).
// These are fdlibm's (musl's) kernels in plain + - * / only: IEEE 754 rounds those the same everywhere, and neither
// JS nor Rust fuses a multiply-add unasked. Bit tricks are swapped for comparisons that land on the same branches.
// `Math.sqrt`, `floor`, `abs`, `min` and `max` are exact already.

/** |(x, z)|: sqrt(x² + z²), exact everywhere (Math.hypot isn't). */
export const hypot = (x: number, z: number) => Math.sqrt(x * x + z * z);

const signbit = (x: number) => x < 0 || (x === 0 && 1 / x < 0);

// Range reduction: x = n·π/2 + (y0 + y1), |y0 + y1| ≲ π/4, in two Cody-Waite rounds (good to about 118 bits for
// the angles a fight sees). The quadrant is kept as a float so it can't wrap the way an int32 would.
const INVPIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
let y0 = 0, y1 = 0;
function reduce(x: number): number {
  const fn = Math.floor(x * INVPIO2 + 0.5);
  const t = x - fn * PIO2_1;
  let w = fn * PIO2_2;
  const r = t - w;
  w = fn * PIO2_2T - ((t - r) - w);
  y0 = r - w; y1 = (r - y0) - w;
  return fn - 4 * Math.floor(fn * 0.25);
}

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function kSin(x: number, y: number) {
  const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * x;
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kCos(x: number, y: number) {
  const z = x * x, w = z * z, r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z, u = 1 - hz;
  return u + (((1 - u) - hz) + (z * r - x * y));
}

export function sin(x: number): number {
  const q = reduce(x);
  return q === 0 ? kSin(y0, y1) : q === 1 ? kCos(y0, y1) : q === 2 ? -kSin(y0, y1) : -kCos(y0, y1);
}
export function cos(x: number): number {
  const q = reduce(x);
  return q === 0 ? kCos(y0, y1) : q === 1 ? -kSin(y0, y1) : q === 2 ? -kCos(y0, y1) : kSin(y0, y1);
}
export const tan = (x: number) => sin(x) / cos(x);

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00] as const;
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17] as const;
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02] as const;

export function atan(x: number): number {
  if (x !== x) return x;
  const neg = signbit(x);
  let ax = Math.abs(x), id: number;
  if (ax >= 7.378697629483821e19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3]; // 2^66
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return x; // 2^-27
    id = -1; ax = x;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); } else { id = 1; ax = (ax - 1) / (ax + 1); }
  } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); } else { id = 3; ax = -1 / ax; }
  const z = ax * ax, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return ax - ax * (s1 + s2);
  const r = ATANHI[id]! - ((ax * (s1 + s2) - ATANLO[id]!) - ax);
  return neg ? -r : r;
}

const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PIO2 = 1.5707963267948965580e+00, PIO4 = 0.7853981633974483;
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (x === 1) return atan(y);
  const m = (signbit(y) ? 1 : 0) | (signbit(x) ? 2 : 0);
  if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI : -PI;
  if (x === 0) return m & 1 ? -PIO2 : PIO2;
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity) {
    if (ay === Infinity) return m === 0 ? PIO4 : m === 1 ? -PIO4 : m === 2 ? 3 * PIO4 : -3 * PIO4;
    return m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI : -PI;
  }
  if (ay === Infinity || ay > ax * 1.8446744073709552e19) return m & 1 ? -PIO2 : PIO2; // |y/x| > 2^64
  const z = m & 2 && ay * 1.8446744073709552e19 < ax ? 0 : atan(ay / ax);
  return m === 0 ? z : m === 1 ? -z : m === 2 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
/** y·2^k by doubling or halving, each step exact (no bits to set). */
function scale(y: number, k: number) {
  for (; k > 0; k--) y *= 2;
  for (; k < 0; k++) y *= 0.5;
  return y;
}
export function exp(x: number): number {
  if (x !== x) return x;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const ax = Math.abs(x);
  let hi = x, lo = 0, k = 0;
  if (ax > 0.5 * LN2_HI) {
    k = ax < 1.5 * LN2_HI ? (x < 0 ? -1 : 1) : Math.trunc(INVLN2 * x + (x < 0 ? -0.5 : 0.5));
    hi = x - k * LN2_HI; lo = k * LN2_LO; x = hi - lo;
  } else if (ax < 3.725290298461914e-9) return 1 + x; // 2^-28
  const xx = x * x, c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
  const y = 1 + ((x * c) / (2 - c) - lo + hi);
  return k === 0 ? y : scale(y, k);
}

const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01, LG4 = 2.222219843214978396e-01,
  LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01, SQRT2 = 1.4142135623730951;
export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let k = 0;
  // Into [√2/2, √2): halving and doubling are exact.
  while (x >= SQRT2) { x *= 0.5; k++; }
  while (x < SQRT2 / 2) { x *= 2; k--; }
  const f = x - 1, hfsq = 0.5 * f * f, s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))), r = t2 + t1;
  return s * (hfsq + r) + k * LN2_LO - hfsq + f + k * LN2_HI;
}
/** x^y for x ≥ 0, as exp(y·log x): within a few last bits of Math.pow, and the same bits everywhere. */
export const pow = (x: number, y: number) => (x === 0 ? (y > 0 ? 0 : y === 0 ? 1 : Infinity) : exp(y * log(x)));
