//! qCRM's engine: a pixel-art breaking wave for the hero (`wave_frame`) and the CRM
//! analysis that runs in the browser over rows the API already handed the page
//! (`dedupe`, `forecast`, `stale`). Built to wasm by `apps/qcrm/scripts/wasm.ts`.

use serde::{Deserialize, Serialize};
use serde::de::{self, Deserializer, IgnoredAny, Visitor};
use serde::ser::Serializer;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

// ───────────────────────────── wave shader ─────────────────────────────

/// Seconds per loop: the crest crosses the frame once and wraps.
const LOOP_SECS: f32 = 12.0;

#[inline]
fn hash(x: u32, y: u32, z: u32) -> u32 {
    let mut h = x.wrapping_mul(0x8da6_b343) ^ y.wrapping_mul(0xd825_5a18) ^ z.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^= h >> 15;
    h
}

/// Hash noise in [0, 1).
#[inline]
fn noise(x: u32, y: u32, z: u32) -> f32 {
    (hash(x, y, z) >> 8) as f32 / 16_777_216.0
}

#[inline]
fn unpack(c: u32) -> [f32; 3] {
    [((c >> 16) & 255) as f32, ((c >> 8) & 255) as f32, (c & 255) as f32]
}

#[inline]
fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    let t = t.clamp(0.0, 1.0);
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

#[inline]
fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Fill `out` (RGBA, `w`×`h`) with one frame of the wave at time `t` (seconds), in blocks of
/// `pixel` screen pixels. Colours are `0xRRGGBB`. Pure in `t`, and `t` and `t + 12` match.
#[wasm_bindgen]
pub fn wave_frame(out: &mut [u8], w: u32, h: u32, t: f32, pixel: u32, sky: u32, navy: u32, cream: u32) {
    let pixel = pixel.clamp(1, 64) as usize;
    let (w, h) = (w as usize, h as usize);
    if out.len() < w * h * 4 || w == 0 || h == 0 {
        return;
    }
    let sky = unpack(sky);
    let navy = unpack(navy);
    let cream = unpack(cream);
    let deep = mix(navy, [0.0, 0.0, 0.0], 0.35);

    // Everything below is a function of the phase, so the loop is seamless.
    let phase = (t / LOOP_SECS).rem_euclid(1.0);
    let tau = phase * std::f32::consts::TAU;
    // The crest runs left→right across a margin wider than the frame so it enters and leaves.
    let crest_x = phase * 1.6 - 0.3;
    let flicker = (phase * 96.0) as u32; // spray twinkles 8×/s, same twinkle every loop

    let bw = (w + pixel - 1) / pixel;
    let bh = (h + pixel - 1) / pixel;
    let aspect = w as f32 / h as f32;

    for by in 0..bh {
        let v = (by as f32 + 0.5) / bh as f32; // 0 top → 1 bottom
        for bx in 0..bw {
            let u = (bx as f32 + 0.5) / bw as f32;
            // Distance ahead of the crest (positive = unbroken face to the right), wrapped over
            // the crest's 1.6-wide lap so the wash trailing off the right edge is the same wash
            // entering on the left: the loop has no seam.
            let d = (u - crest_x + 0.8).rem_euclid(1.6) - 0.8;
            // Swell profile: steep face ahead of the crest, long shoulder behind it.
            let swell = if d >= 0.0 { (-d * d * 90.0).exp() } else { (-d * d * 14.0).exp() };
            // Long background rollers, periodic in the phase.
            let roll = 0.025 * (u * 9.0 * aspect / 3.2 + tau).sin() + 0.015 * (u * 17.0 - 2.0 * tau).sin();
            let surface = 0.60 - swell * 0.34 + roll;
            // How far behind the crest (the broken side, to the left).
            let behind = (-d).max(0.0);
            let crest_y = 0.26 + roll;

            let mut c: [f32; 3];
            if v >= surface {
                // Ocean: navy, lit toward sky under the swell, darkening with depth.
                let depth = smooth(surface, 1.0, v);
                c = mix(mix(navy, deep, depth * 0.8), sky, swell * 0.5 * (1.0 - depth));
                // Face of the wave: a translucent sky-blue wall just ahead of the crest.
                if d > 0.0 && d < 0.14 {
                    let face = smooth(0.14, 0.0, d) * (1.0 - smooth(surface, surface + 0.3, v));
                    c = mix(c, sky, face * 0.85);
                }
            } else {
                // Above the water: the hero's navy, a hint of sky toward the horizon.
                c = mix(navy, sky, 0.10 * (1.0 - smooth(0.0, surface, v)));
            }

            // White water: the wash behind the crest. A tumbling pile right behind the lip that
            // streaks out along the surface and fades from cream to sky as it thins and falls.
            if behind > 0.0 && behind < 0.5 {
                let age = smooth(0.0, 0.5, behind);
                let streak = noise(bx as u32 / 3, by as u32, (phase * 6.0) as u32 + 3);
                let grain = noise(bx as u32, by as u32, (phase * 10.0) as u32 + 11);
                // The pile: tallest just behind the crest, its top edge ragged.
                let pile = 0.13 * (1.0 - smooth(0.0, 0.14, behind)).sqrt() * (0.75 + 0.5 * grain);
                let top = surface - pile;
                let sink = surface + 0.12 * (1.0 - age) + 0.08 * streak;
                if v >= top && v < sink {
                    let body = if v < surface { 1.0 } else { 1.0 - smooth(surface, sink, v) };
                    let tint = mix(cream, sky, age * 0.9);
                    let cover = body * (1.0 - age * 0.55) * (0.55 + 0.45 * streak);
                    c = mix(c, tint, smooth(0.15, 0.8, cover));
                }
            }

            // The lip: a cream barrel hooking forward and down from the crest, dark pocket inside.
            let radius = 0.075f32;
            let dx = (u - crest_x - 0.004) * aspect;
            let dy = v - (crest_y + radius);
            let r = (dx * dx + dy * dy).sqrt();
            if r < radius + 0.04 && d > -0.08 {
                let ang = dy.atan2(dx); // -π/2 is the top of the barrel, 0 is straight ahead
                let thick = 0.03;
                let sweep = smooth(1.25, 0.9, ang) * smooth(-2.9, -2.4, ang); // from the back over the top to the hook
                if (r - radius).abs() < thick && sweep > 0.0 {
                    let edge = 1.0 - (r - radius).abs() / thick;
                    c = mix(c, cream, smooth(0.0, 0.45, edge) * sweep);
                } else if r < radius - thick * 0.5 && ang > -1.6 && v < surface + 0.02 {
                    // The hollow under the lip.
                    c = mix(c, mix(navy, sky, 0.25), 0.7 * smooth(radius, radius * 0.4, r));
                }
            }

            // Spray: what the lip throws, rising ahead of the crest and raining down behind it,
            // cream when fresh and sky-blue as it falls.
            if v < surface && behind < 0.26 && d < 0.05 {
                let along = d.max(-0.26); // -0.26 … 0.05
                let up = crest_y - v; // height above the crest line
                let arc = 0.02 + 1.3 * (-along) - 4.6 * along * along; // thrown up, then falls
                let spread = 0.035 + (-along) * 0.45;
                let band = 1.0 - ((up - arc) / spread).abs().min(1.0);
                // Clumps of 2×2 blocks twinkling at 8 Hz so the spray reads as droplets, not sand.
                let n = noise(bx as u32 / 2, by as u32 / 2, flicker);
                let age = smooth(-0.02, 0.26, -along);
                let density = band * (0.95 - age * 0.6);
                if n < density * 0.5 {
                    c = mix(c, mix(cream, sky, age * 0.8), 0.95);
                }
            }

            // Write the block.
            let px = [c[0].round() as u8, c[1].round() as u8, c[2].round() as u8, 255];
            let x0 = bx * pixel;
            let x1 = (x0 + pixel).min(w);
            let y0 = by * pixel;
            let y1 = (y0 + pixel).min(h);
            for y in y0..y1 {
                let row = &mut out[(y * w + x0) * 4..(y * w + x1) * 4];
                for p in row.chunks_exact_mut(4) {
                    p.copy_from_slice(&px);
                }
            }
        }
    }
}

// ───────────────────────────── analysis engine ─────────────────────────────

const MS_PER_DAY: f64 = 86_400_000.0;

/// A loosely typed cell: ids come as numbers or strings, timestamps as ms or ISO strings, and
/// anything may be null. Hand-rolled so the wasm stays small (no `serde_json::Value`).
#[derive(Clone, Debug, PartialEq)]
pub enum Loose {
    Int(i64),
    Num(f64),
    Str(String),
    Null,
}

impl Default for Loose {
    fn default() -> Self {
        Loose::Null
    }
}

impl<'de> Deserialize<'de> for Loose {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Loose;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a number, string or null")
            }
            fn visit_i64<E>(self, v: i64) -> Result<Loose, E> { Ok(Loose::Int(v)) }
            fn visit_u64<E>(self, v: u64) -> Result<Loose, E> { Ok(i64::try_from(v).map(Loose::Int).unwrap_or(Loose::Num(v as f64))) }
            fn visit_f64<E>(self, v: f64) -> Result<Loose, E> { Ok(Loose::Num(v)) }
            fn visit_bool<E>(self, v: bool) -> Result<Loose, E> { Ok(Loose::Int(v as i64)) }
            fn visit_str<E>(self, v: &str) -> Result<Loose, E> { Ok(Loose::Str(v.to_string())) }
            fn visit_string<E>(self, v: String) -> Result<Loose, E> { Ok(Loose::Str(v)) }
            fn visit_unit<E>(self) -> Result<Loose, E> { Ok(Loose::Null) }
            fn visit_none<E>(self) -> Result<Loose, E> { Ok(Loose::Null) }
            fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Loose, D2::Error> { Loose::deserialize(d) }
            fn visit_seq<A: de::SeqAccess<'de>>(self, mut a: A) -> Result<Loose, A::Error> {
                while a.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Loose::Null)
            }
            fn visit_map<A: de::MapAccess<'de>>(self, mut a: A) -> Result<Loose, A::Error> {
                while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Loose::Null)
            }
        }
        d.deserialize_any(V)
    }
}

impl Serialize for Loose {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Loose::Int(i) => s.serialize_i64(*i),
            Loose::Num(n) => s.serialize_f64(*n),
            Loose::Str(v) => s.serialize_str(v),
            Loose::Null => s.serialize_unit(),
        }
    }
}

/// Plain decimal (`-12.5`, `300`) → f64; keeps core's full float parser out of the binary.
fn dec(s: &str) -> Option<f64> {
    let s = s.trim();
    let (neg, body) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let (int, frac) = body.split_once('.').unwrap_or((body, ""));
    if int.is_empty() && frac.is_empty() || !int.bytes().chain(frac.bytes()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut v = 0.0f64;
    for c in int.bytes() {
        v = v * 10.0 + (c - b'0') as f64;
    }
    let mut scale = 0.1;
    for c in frac.bytes() {
        v += (c - b'0') as f64 * scale;
        scale *= 0.1;
    }
    Some(if neg { -v } else { v })
}

/// A row id as the API sent it (number or string); echoed back untouched.
type Id = Loose;

#[derive(Deserialize, Default)]
#[serde(default)]
struct Contact {
    id: Id,
    first_name: Option<String>,
    last_name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    company_id: Option<Loose>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Deal {
    id: Id,
    name: Option<String>,
    stage: Option<String>,
    amount_cents: Option<Loose>,
    close_at: Option<Loose>,
    #[allow(dead_code)]
    contact_id: Option<Loose>,
    #[allow(dead_code)]
    company_id: Option<Loose>,
    updated_at: Option<Loose>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Activity {
    #[allow(dead_code)]
    id: Id,
    deal_id: Option<Loose>,
    #[allow(dead_code)]
    contact_id: Option<Loose>,
    at: Option<Loose>,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    kind: Option<String>,
}

fn rows<T: for<'de> Deserialize<'de>>(json: &str) -> Vec<T> {
    serde_json::from_str(json).unwrap_or_default()
}

fn num(v: &Option<Loose>) -> f64 {
    match v {
        Some(Loose::Int(i)) => *i as f64,
        Some(Loose::Num(n)) => *n,
        Some(Loose::Str(s)) => dec(s).unwrap_or(0.0),
        _ => 0.0,
    }
}

fn key(v: &Option<Loose>) -> Option<String> {
    match v {
        Some(Loose::Null) | None => None,
        Some(Loose::Str(s)) if s.trim().is_empty() => None,
        Some(Loose::Str(s)) => Some(s.trim().to_string()),
        Some(Loose::Int(i)) => Some(i.to_string()),
        Some(Loose::Num(n)) => Some(n.to_string()),
    }
}

/// Howard Hinnant's days-from-civil, for month maths without a date crate.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A timestamp as ms since the epoch: a number (ms, or seconds when small), a digit string, or
/// an ISO-ish `YYYY-MM-DD[THH:MM[:SS]]` string. Anything else is `None`.
fn when(v: &Option<Loose>) -> Option<f64> {
    match v {
        Some(Loose::Int(i)) => Some(if i.abs() < 100_000_000_000 { (*i as f64) * 1000.0 } else { *i as f64 }),
        Some(Loose::Num(x)) => Some(if x.abs() < 1e11 { x * 1000.0 } else { *x }),
        Some(Loose::Str(s)) => {
            let s = s.trim();
            if s.is_empty() {
                return None;
            }
            if let Some(x) = dec(s) {
                return Some(if x.abs() < 1e11 { x * 1000.0 } else { x });
            }
            let b = s.as_bytes();
            let digits = |a: usize, n: usize| -> Option<i64> {
                let part = s.get(a..a + n)?;
                if part.bytes().all(|c| c.is_ascii_digit()) { part.parse().ok() } else { None }
            };
            if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
                return None;
            }
            let (y, m, d) = (digits(0, 4)?, digits(5, 2)? as u32, digits(8, 2)? as u32);
            if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
                return None;
            }
            let mut ms = days_from_civil(y, m, d) as f64 * MS_PER_DAY;
            if b.len() >= 16 && (b[10] == b'T' || b[10] == b' ') && b[13] == b':' {
                ms += (digits(11, 2)? * 3_600_000 + digits(14, 2)? * 60_000) as f64;
                if b.len() >= 19 && b[16] == b':' {
                    ms += (digits(17, 2)? * 1000) as f64;
                }
            }
            Some(ms)
        }
        _ => None,
    }
}

fn month_key(ms: f64) -> String {
    let (y, m, _) = civil_from_days((ms / MS_PER_DAY).floor() as i64);
    format!("{y:04}-{m:02}")
}

fn add_months(y: i64, m: u32, n: u32) -> (i64, u32) {
    let total = y * 12 + (m as i64 - 1) + n as i64;
    (total.div_euclid(12), (total.rem_euclid(12) + 1) as u32)
}

// ── dedupe ──

fn norm_local(email: &str) -> Option<(String, String)> {
    let e = email.trim().to_ascii_lowercase();
    let (local, domain) = e.rsplit_once('@')?;
    let local = local.split('+').next().unwrap_or("");
    let local: String = local.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if local.is_empty() || domain.is_empty() {
        return None;
    }
    Some((local, domain.to_string()))
}

fn norm_phone(phone: &str) -> Option<String> {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 7 {
        return None;
    }
    // Compare the last ten digits so "+1 (555) 010-2020" and "5550102020" meet.
    let keep = digits.len().min(10);
    Some(digits[digits.len() - keep..].to_string())
}

fn norm_name(s: &str) -> String {
    s.trim().to_ascii_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Jaro-Winkler similarity in [0, 1] (prefix bonus up to 4 chars, p = 0.1).
pub fn jaro_winkler(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let window = (a.len().max(b.len()) / 2).saturating_sub(1);
    let mut a_hit = vec![false; a.len()];
    let mut b_hit = vec![false; b.len()];
    let mut matches = 0usize;
    for (i, &ca) in a.iter().enumerate() {
        let lo = i.saturating_sub(window);
        let hi = (i + window + 1).min(b.len());
        for j in lo..hi {
            if !b_hit[j] && b[j] == ca {
                a_hit[i] = true;
                b_hit[j] = true;
                matches += 1;
                break;
            }
        }
    }
    if matches == 0 {
        return 0.0;
    }
    let mut transpositions = 0usize;
    let mut j = 0usize;
    for (i, &hit) in a_hit.iter().enumerate() {
        if !hit {
            continue;
        }
        while !b_hit[j] {
            j += 1;
        }
        if a[i] != b[j] {
            transpositions += 1;
        }
        j += 1;
    }
    let m = matches as f64;
    let jaro = (m / a.len() as f64 + m / b.len() as f64 + (m - (transpositions / 2) as f64) / m) / 3.0;
    let prefix = a.iter().zip(&b).take(4).take_while(|(x, y)| x == y).count() as f64;
    jaro + prefix * 0.1 * (1.0 - jaro)
}

#[derive(Serialize)]
struct Pair {
    a: Id,
    b: Id,
    score: f64,
    why: Vec<&'static str>,
}

struct Norm {
    email: Option<(String, String)>,
    phone: Option<String>,
    last: Option<String>,
    company: Option<String>,
    name: String,
}

/// Likely duplicate contacts as `[{a, b, score, why}]`, best first. `score` combines the
/// signals noisy-or style; pairs under 0.5 are dropped.
#[wasm_bindgen]
pub fn dedupe(contacts_json: &str) -> String {
    dedupe_slice(contacts_json, 0, u32::MAX)
}

/// `dedupe` for the pairs whose first row index is in `start..end`, unsorted-merge friendly: the
/// browser runs one slice per core in Web Workers and merges the results by score.
#[wasm_bindgen]
pub fn dedupe_slice(contacts_json: &str, start: u32, end: u32) -> String {
    let contacts: Vec<Contact> = rows(contacts_json);
    let norms: Vec<Norm> = contacts
        .iter()
        .map(|c| Norm {
            email: c.email.as_deref().and_then(norm_local),
            phone: c.phone.as_deref().and_then(norm_phone),
            last: c.last_name.as_deref().map(norm_name).filter(|s| !s.is_empty()),
            company: key(&c.company_id),
            name: norm_name(&format!("{} {}", c.first_name.as_deref().unwrap_or(""), c.last_name.as_deref().unwrap_or(""))),
        })
        .collect();
    let mut pairs = Vec::new();
    for i in (start as usize).min(contacts.len())..(end as usize).min(contacts.len()) {
        for j in i + 1..contacts.len() {
            let (x, y) = (&norms[i], &norms[j]);
            let mut miss = 1.0f64;
            let mut why = Vec::new();
            if let (Some(ex), Some(ey)) = (&x.email, &y.email) {
                if ex.0 == ey.0 {
                    if ex.1 == ey.1 {
                        miss *= 1.0 - 0.95;
                        why.push("same email");
                    } else {
                        miss *= 1.0 - 0.5;
                        why.push("same email name, different domain");
                    }
                }
            }
            if let (Some(px), Some(py)) = (&x.phone, &y.phone) {
                if px == py {
                    miss *= 1.0 - 0.8;
                    why.push("same phone");
                }
            }
            if let (Some(lx), Some(ly), Some(cx), Some(cy)) = (&x.last, &y.last, &x.company, &y.company) {
                if lx == ly && cx == cy {
                    miss *= 1.0 - 0.6;
                    why.push("same last name and company");
                }
            }
            if !x.name.is_empty() && !y.name.is_empty() {
                let jw = jaro_winkler(&x.name, &y.name);
                if jw >= 0.92 {
                    // 0.92 → 0.3, 1.0 → 0.55
                    miss *= 1.0 - (0.3 + (jw - 0.92) / 0.08 * 0.25);
                    why.push(if jw >= 0.999 { "same name" } else { "near-identical name" });
                }
            }
            let score = 1.0 - miss;
            if score >= 0.5 {
                pairs.push(Pair { a: contacts[i].id.clone(), b: contacts[j].id.clone(), score: (score * 1000.0).round() / 1000.0, why });
            }
        }
    }
    pairs.sort_by(|p, q| q.score.partial_cmp(&p.score).unwrap_or(std::cmp::Ordering::Equal));
    serde_json::to_string(&pairs).unwrap_or_else(|_| "[]".into())
}

// ── forecast ──

fn stage_weight(stage: &str) -> f64 {
    match stage.trim().to_ascii_lowercase().as_str() {
        "lead" => 0.1,
        "qualified" => 0.3,
        "proposal" => 0.6,
        "won" | "closed_won" | "closed-won" => 1.0,
        _ => 0.0,
    }
}

fn is_open(stage: &Option<String>) -> bool {
    let s = stage.as_deref().unwrap_or("").trim().to_ascii_lowercase();
    !(s.starts_with("won") || s.starts_with("lost") || s.starts_with("closed"))
}

#[derive(Serialize, Default)]
struct StageTotal {
    stage: String,
    weight: f64,
    count: usize,
    amount_cents: f64,
    weighted_cents: f64,
}

#[derive(Serialize, Default)]
struct MonthTotal {
    month: String,
    count: usize,
    amount_cents: f64,
    weighted_cents: f64,
}

#[derive(Serialize)]
struct Forecast {
    stages: Vec<StageTotal>,
    months: Vec<MonthTotal>,
    unscheduled_cents: f64,
    unscheduled_weighted_cents: f64,
    total_weighted_cents: f64,
}

/// Weighted pipeline per stage (lead .1, qualified .3, proposal .6) over the open deals, and the
/// expected (weighted) close per month for the six months starting at `now_ms`'s month.
#[wasm_bindgen]
pub fn forecast(deals_json: &str, now_ms: f64) -> String {
    let deals: Vec<Deal> = rows(deals_json);
    let order = ["lead", "qualified", "proposal"];
    let mut stages: BTreeMap<String, StageTotal> = BTreeMap::new();
    for s in order {
        stages.insert(s.into(), StageTotal { stage: s.into(), weight: stage_weight(s), ..Default::default() });
    }
    let (ny, nm, _) = civil_from_days((now_ms / MS_PER_DAY).floor() as i64);
    let mut months: Vec<MonthTotal> = (0..6)
        .map(|i| {
            let (y, m) = add_months(ny, nm, i);
            MonthTotal { month: format!("{y:04}-{m:02}"), ..Default::default() }
        })
        .collect();
    let (mut unscheduled, mut unscheduled_w, mut total_w) = (0.0, 0.0, 0.0);
    for d in deals.iter().filter(|d| is_open(&d.stage)) {
        let stage = d.stage.as_deref().unwrap_or("").trim().to_ascii_lowercase();
        let stage = if stage.is_empty() { "unknown".to_string() } else { stage };
        let amount = num(&d.amount_cents);
        let weight = stage_weight(&stage);
        let weighted = amount * weight;
        total_w += weighted;
        let s = stages.entry(stage.clone()).or_insert_with(|| StageTotal { stage: stage.clone(), weight, ..Default::default() });
        s.count += 1;
        s.amount_cents += amount;
        s.weighted_cents += weighted;
        match when(&d.close_at) {
            Some(ms) if ms >= now_ms - MS_PER_DAY * 31.0 => {
                let k = month_key(ms);
                if let Some(mt) = months.iter_mut().find(|m| m.month == k) {
                    mt.count += 1;
                    mt.amount_cents += amount;
                    mt.weighted_cents += weighted;
                }
            }
            _ => {
                unscheduled += amount;
                unscheduled_w += weighted;
            }
        }
    }
    let mut stages: Vec<StageTotal> = stages.into_values().collect();
    stages.sort_by_key(|s| order.iter().position(|o| *o == s.stage).unwrap_or(order.len()));
    let out = Forecast { stages, months, unscheduled_cents: unscheduled, unscheduled_weighted_cents: unscheduled_w, total_weighted_cents: total_w };
    serde_json::to_string(&out).unwrap_or_else(|_| "{}".into())
}

// ── stale ──

#[derive(Serialize)]
struct Stale {
    id: Id,
    name: Option<String>,
    stage: Option<String>,
    amount_cents: f64,
    /// Last activity (or, with none, the deal's `updated_at`); null when neither is known.
    last_touch_at: Option<f64>,
    days_idle: Option<f64>,
}

/// Open deals with no activity in the last `days` days, oldest touch first (never-touched first).
#[wasm_bindgen]
pub fn stale(deals_json: &str, activities_json: &str, now_ms: f64, days: f64) -> String {
    let deals: Vec<Deal> = rows(deals_json);
    let activities: Vec<Activity> = rows(activities_json);
    let mut last: BTreeMap<String, f64> = BTreeMap::new();
    for a in &activities {
        if let (Some(k), Some(ms)) = (key(&a.deal_id), when(&a.at)) {
            let e = last.entry(k).or_insert(ms);
            if ms > *e {
                *e = ms;
            }
        }
    }
    let cutoff = now_ms - days.max(0.0) * MS_PER_DAY;
    let mut out: Vec<Stale> = deals
        .iter()
        .filter(|d| is_open(&d.stage))
        .filter_map(|d| {
            let touch = key(&Some(d.id.clone())).and_then(|k| last.get(&k).copied()).or_else(|| when(&d.updated_at));
            match touch {
                Some(ms) if ms > cutoff => None,
                _ => Some(Stale {
                    id: d.id.clone(),
                    name: d.name.clone(),
                    stage: d.stage.clone(),
                    amount_cents: num(&d.amount_cents),
                    last_touch_at: touch,
                    days_idle: touch.map(|ms| ((now_ms - ms) / MS_PER_DAY * 10.0).round() / 10.0),
                }),
            }
        })
        .collect();
    out.sort_by(|a, b| match (a.last_touch_at, b.last_touch_at) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, _) => std::cmp::Ordering::Less,
        (_, None) => std::cmp::Ordering::Greater,
        (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
    });
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jw_basics() {
        assert!((jaro_winkler("martha", "marhta") - 0.961).abs() < 0.01);
        assert_eq!(jaro_winkler("abc", "abc"), 1.0);
        assert_eq!(jaro_winkler("abc", "xyz"), 0.0);
    }

    #[test]
    fn dates_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(days_from_civil(2026, 10, 16)), (2026, 10, 16));
        assert_eq!(when(&Some(Loose::Str("2026-10-16".into()))), Some(days_from_civil(2026, 10, 16) as f64 * MS_PER_DAY));
        assert_eq!(add_months(2026, 11, 3), (2027, 2));
    }

    #[test]
    fn wave_loops() {
        let (w, h) = (64u32, 32u32);
        let mut a = vec![0u8; (w * h * 4) as usize];
        let mut b = a.clone();
        wave_frame(&mut a, w, h, 3.0, 8, 0x7cc4ff, 0x0b1f3a, 0xf4eee2);
        wave_frame(&mut b, w, h, 15.0, 8, 0x7cc4ff, 0x0b1f3a, 0xf4eee2);
        assert_eq!(a, b);
        assert!(a.chunks_exact(4).all(|p| p[3] == 255));
    }
}
