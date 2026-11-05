//! src/dmath.ts line for line: fdlibm's kernels in plain + - * /, so native, wasm and every JS engine agree on
//! every bit. Rust never fuses a multiply-add unasked, and these never call the platform libm.

/// |(x, z)|: sqrt(x² + z²), exact everywhere.
#[inline]
pub fn hypot(x: f64, z: f64) -> f64 {
    (x * x + z * z).sqrt()
}

#[inline]
fn signbit(x: f64) -> bool {
    x.is_sign_negative() && !x.is_nan()
}

/// JS `Math.min`: NaN wins, and -0 is less than +0.
#[inline]
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else if b < a {
        b
    } else if signbit(a) {
        a
    } else {
        b
    }
}
/// JS `Math.max`: NaN wins, and +0 is more than -0.
#[inline]
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == b && !signbit(a)) {
        a
    } else {
        b
    }
}
/// `@rustybuns/util` clamp: Math.max(lo, Math.min(hi, v)).
#[inline]
pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    max(lo, min(hi, v))
}
#[inline]
pub fn lerp(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}
/// JS `Math.round`: halves go up, and what rounds to zero from below is -0.
#[inline]
pub fn round(x: f64) -> f64 {
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && signbit(x) {
        -0.0
    } else {
        r
    }
}
/// JS `x || 1`: a falsy number (0, -0, NaN) is 1.
#[inline]
pub fn or1(x: f64) -> f64 {
    if x == 0.0 || x.is_nan() {
        1.0
    } else {
        x
    }
}

const INVPIO2: f64 = 6.36619772367581382433e-01;
const PIO2_1: f64 = 1.57079632673412561417e+00;
const PIO2_2: f64 = 6.07710050630396597660e-11;
const PIO2_2T: f64 = 2.02226624879595063154e-21;

fn reduce(x: f64) -> (f64, f64, f64) {
    let fn_ = (x * INVPIO2 + 0.5).floor();
    let t = x - fn_ * PIO2_1;
    let mut w = fn_ * PIO2_2;
    let r = t - w;
    w = fn_ * PIO2_2T - ((t - r) - w);
    let y0 = r - w;
    let y1 = (r - y0) - w;
    (fn_ - 4.0 * (fn_ * 0.25).floor(), y0, y1)
}

const S1: f64 = -1.66666666666666324348e-01;
const S2: f64 = 8.33333333332248946124e-03;
const S3: f64 = -1.98412698298579493134e-04;
const S4: f64 = 2.75573137070700676789e-06;
const S5: f64 = -2.50507602534068634195e-08;
const S6: f64 = 1.58969099521155010221e-10;
fn k_sin(x: f64, y: f64) -> f64 {
    let z = x * x;
    let w = z * z;
    let r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
    let v = z * x;
    x - ((z * (0.5 * y - v * r) - y) - v * S1)
}
const C1: f64 = 4.16666666666666019037e-02;
const C2: f64 = -1.38888888888741095749e-03;
const C3: f64 = 2.48015872894767294178e-05;
const C4: f64 = -2.75573143513906633035e-07;
const C5: f64 = 2.08757232129817482790e-09;
const C6: f64 = -1.13596475577881948265e-11;
fn k_cos(x: f64, y: f64) -> f64 {
    let z = x * x;
    let w = z * z;
    let r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    let hz = 0.5 * z;
    let u = 1.0 - hz;
    u + (((1.0 - u) - hz) + (z * r - x * y))
}

pub fn sin(x: f64) -> f64 {
    let (q, y0, y1) = reduce(x);
    if q == 0.0 {
        k_sin(y0, y1)
    } else if q == 1.0 {
        k_cos(y0, y1)
    } else if q == 2.0 {
        -k_sin(y0, y1)
    } else {
        -k_cos(y0, y1)
    }
}
pub fn cos(x: f64) -> f64 {
    let (q, y0, y1) = reduce(x);
    if q == 0.0 {
        k_cos(y0, y1)
    } else if q == 1.0 {
        -k_sin(y0, y1)
    } else if q == 2.0 {
        -k_cos(y0, y1)
    } else {
        k_sin(y0, y1)
    }
}
pub fn tan(x: f64) -> f64 {
    sin(x) / cos(x)
}

const ATANHI: [f64; 4] = [
    4.63647609000806093515e-01,
    7.85398163397448278999e-01,
    9.82793723247329054082e-01,
    1.57079632679489655800e+00,
];
const ATANLO: [f64; 4] = [
    2.26987774529616870924e-17,
    3.06161699786838301793e-17,
    1.39033110312309984516e-17,
    6.12323399573676603587e-17,
];
const AT: [f64; 11] = [
    3.33333333333329318027e-01,
    -1.99999999998764832476e-01,
    1.42857142725034663711e-01,
    -1.11111104054623557880e-01,
    9.09088713343650656196e-02,
    -7.69187620504482999495e-02,
    6.66107313738753120669e-02,
    -5.83357013379057348645e-02,
    4.97687799461593236017e-02,
    -3.65315727442169155270e-02,
    1.62858201153657823623e-02,
];

pub fn atan(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    let neg = signbit(x);
    let mut ax = x.abs();
    let id: i32;
    if ax >= 7.378697629483821e19 {
        return if neg { -(ATANHI[3] + ATANLO[3]) } else { ATANHI[3] + ATANLO[3] };
    }
    if ax < 0.4375 {
        if ax < 7.450580596923828e-9 {
            return x;
        }
        id = -1;
        ax = x;
    } else if ax < 1.1875 {
        if ax < 0.6875 {
            id = 0;
            ax = (2.0 * ax - 1.0) / (2.0 + ax);
        } else {
            id = 1;
            ax = (ax - 1.0) / (ax + 1.0);
        }
    } else if ax < 2.4375 {
        id = 2;
        ax = (ax - 1.5) / (1.0 + 1.5 * ax);
    } else {
        id = 3;
        ax = -1.0 / ax;
    }
    let z = ax * ax;
    let w = z * z;
    let s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    let s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if id < 0 {
        return ax - ax * (s1 + s2);
    }
    let i = id as usize;
    let r = ATANHI[i] - ((ax * (s1 + s2) - ATANLO[i]) - ax);
    if neg {
        -r
    } else {
        r
    }
}

const PI: f64 = 3.1415926535897931160e+00;
const PI_LO: f64 = 1.2246467991473531772e-16;
const PIO2: f64 = 1.5707963267948965580e+00;
const PIO4: f64 = 0.7853981633974483;
pub fn atan2(y: f64, x: f64) -> f64 {
    if x.is_nan() || y.is_nan() {
        return x + y;
    }
    if x == 1.0 {
        return atan(y);
    }
    let m = (if signbit(y) { 1 } else { 0 }) | (if signbit(x) { 2 } else { 0 });
    if y == 0.0 {
        return match m {
            0 | 1 => y,
            2 => PI,
            _ => -PI,
        };
    }
    if x == 0.0 {
        return if m & 1 != 0 { -PIO2 } else { PIO2 };
    }
    let ax = x.abs();
    let ay = y.abs();
    if ax == f64::INFINITY {
        if ay == f64::INFINITY {
            return match m {
                0 => PIO4,
                1 => -PIO4,
                2 => 3.0 * PIO4,
                _ => -3.0 * PIO4,
            };
        }
        return match m {
            0 => 0.0,
            1 => -0.0,
            2 => PI,
            _ => -PI,
        };
    }
    if ay == f64::INFINITY || ay > ax * 1.8446744073709552e19 {
        return if m & 1 != 0 { -PIO2 } else { PIO2 };
    }
    let z = if m & 2 != 0 && ay * 1.8446744073709552e19 < ax { 0.0 } else { atan(ay / ax) };
    match m {
        0 => z,
        1 => -z,
        2 => PI - (z - PI_LO),
        _ => (z - PI_LO) - PI,
    }
}

const LN2_HI: f64 = 6.93147180369123816490e-01;
const LN2_LO: f64 = 1.90821492927058770002e-10;
const INVLN2: f64 = 1.44269504088896338700e+00;
const P1: f64 = 1.66666666666666019037e-01;
const P2: f64 = -2.77777777770155933842e-03;
const P3: f64 = 6.61375632143793436117e-05;
const P4: f64 = -1.65339022054652515390e-06;
const P5: f64 = 4.13813679705723846039e-08;
fn scale(mut y: f64, mut k: f64) -> f64 {
    while k > 0.0 {
        y *= 2.0;
        k -= 1.0;
    }
    while k < 0.0 {
        y *= 0.5;
        k += 1.0;
    }
    y
}
pub fn exp(mut x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    if x > 709.782712893384 {
        return f64::INFINITY;
    }
    if x < -745.1332191019411 {
        return 0.0;
    }
    let ax = x.abs();
    let mut hi = x;
    let mut lo = 0.0;
    let mut k = 0.0;
    if ax > 0.5 * LN2_HI {
        k = if ax < 1.5 * LN2_HI {
            if x < 0.0 {
                -1.0
            } else {
                1.0
            }
        } else {
            (INVLN2 * x + if x < 0.0 { -0.5 } else { 0.5 }).trunc()
        };
        hi = x - k * LN2_HI;
        lo = k * LN2_LO;
        x = hi - lo;
    } else if ax < 3.725290298461914e-9 {
        return 1.0 + x;
    }
    let xx = x * x;
    let c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
    let y = 1.0 + ((x * c) / (2.0 - c) - lo + hi);
    if k == 0.0 {
        y
    } else {
        scale(y, k)
    }
}

const LG1: f64 = 6.666666666666735130e-01;
const LG2: f64 = 3.999999999940941908e-01;
const LG3: f64 = 2.857142874366239149e-01;
const LG4: f64 = 2.222219843214978396e-01;
const LG5: f64 = 1.818357216161805012e-01;
const LG6: f64 = 1.531383769920937332e-01;
const LG7: f64 = 1.479819860511658591e-01;
const SQRT2: f64 = 1.4142135623730951;
pub fn log(mut x: f64) -> f64 {
    if x.is_nan() || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return f64::NEG_INFINITY;
    }
    if x == f64::INFINITY {
        return x;
    }
    let mut k = 0.0;
    while x >= SQRT2 {
        x *= 0.5;
        k += 1.0;
    }
    while x < SQRT2 / 2.0 {
        x *= 2.0;
        k -= 1.0;
    }
    let f = x - 1.0;
    let hfsq = 0.5 * f * f;
    let s = f / (2.0 + f);
    let z = s * s;
    let w = z * z;
    let t1 = w * (LG2 + w * (LG4 + w * LG6));
    let t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    let r = t2 + t1;
    s * (hfsq + r) + k * LN2_LO - hfsq + f + k * LN2_HI
}
/// x^y for x ≥ 0, as exp(y·log x).
pub fn pow(x: f64, y: f64) -> f64 {
    if x == 0.0 {
        if y > 0.0 {
            0.0
        } else if y == 0.0 {
            1.0
        } else {
            f64::INFINITY
        }
    } else {
        exp(y * log(x))
    }
}
