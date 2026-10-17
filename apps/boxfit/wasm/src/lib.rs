// boxFit's engine. One call: `solve(json) -> json`.
//
// Things are boxes with a length, width and height (any unit, the engine never converts). A shipping
// box's numbers are its inside; a product's are its outside. A product with a `wall` above zero is
// itself a box that opens, with a cavity of its size minus a wall on every side, and anything smaller
// can ride inside it. That is the part shipping software misses: a box in a box in a box.
//
// Packing is axis-aligned with all six turns, placed at extreme points, largest first. It is a fast
// heuristic: "fits" is always true when it says so, "doesn't fit" can be a tight case it didn't find.
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const EPS: f64 = 1e-9;
/// More than this many pieces and a heuristic that is quadratic per piece stops being instant.
const MAX_PIECES: usize = 400;

fn one() -> u32 { 1 }

#[derive(Deserialize)]
struct Thing {
    #[serde(default)] name: String,
    l: f64, w: f64, h: f64,
    #[serde(default = "one")] qty: u32,
    #[serde(default)] wall: f64,
}

#[derive(Deserialize)]
struct Input {
    boxes: Vec<Thing>,
    items: Vec<Thing>,
    /// Room kept between neighbouring things (not against a wall).
    #[serde(default)] pad: f64,
}

type V3 = [f64; 3];

/// A piece in its parent's frame: turned `size`, corner at `pos`, with what rides inside it
/// (in its own frame, so turning the piece turns its contents with it).
#[derive(Serialize, Clone)]
struct Placed { name: String, size: V3, pos: V3, inside: Vec<Placed> }

/// A piece plus whatever it already carries.
#[derive(Clone)]
struct Bundle { name: String, dims: V3, wall: f64, inside: Vec<Placed> }

fn vol(d: V3) -> f64 { d[0] * d[1] * d[2] }

fn cavity(b: &Bundle) -> Option<V3> {
    let c = b.dims.map(|d| d - 2.0 * b.wall);
    (b.wall > 0.0 && c.iter().all(|&d| d > EPS)).then_some(c)
}

fn turns(d: V3) -> Vec<V3> {
    let mut out: Vec<V3> = Vec::with_capacity(6);
    for p in [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] {
        let t = [d[p[0]], d[p[1]], d[p[2]]];
        if !out.iter().any(|o| (0..3).all(|k| (o[k] - t[k]).abs() < EPS)) { out.push(t); }
    }
    out
}

fn overlaps(a: (V3, V3), b: (V3, V3)) -> bool {
    (0..3).all(|k| a.0[k] < b.0[k] + b.1[k] - EPS && b.0[k] < a.0[k] + a.1[k] - EPS)
}

/// Put every bundle inside `cav`, or say none of this arrangement works.
fn pack(items: &[&Bundle], cav: V3, pad: f64) -> Option<Vec<Placed>> {
    let room = cav.map(|c| c + pad);
    let mut order: Vec<&Bundle> = items.to_vec();
    order.sort_by(|a, b| vol(b.dims).total_cmp(&vol(a.dims)));
    let mut points: Vec<V3> = vec![[0.0; 3]];
    let mut taken: Vec<(V3, V3)> = Vec::new();
    let mut out = Vec::with_capacity(order.len());
    for b in order {
        points.sort_by(|p, q| p[2].total_cmp(&q[2]).then(p[1].total_cmp(&q[1])).then(p[0].total_cmp(&q[0])));
        let mut spot = None;
        'search: for (i, p) in points.iter().enumerate() {
            for t in turns(b.dims) {
                let s = t.map(|d| d + pad);
                if (0..3).any(|k| p[k] + s[k] > room[k] + EPS) { continue; }
                if taken.iter().any(|&o| overlaps((*p, s), o)) { continue; }
                spot = Some((i, t, s));
                break 'search;
            }
        }
        let (i, t, s) = spot?;
        let p = points.remove(i);
        taken.push((p, s));
        points.extend([[p[0] + s[0], p[1], p[2]], [p[0], p[1] + s[1], p[2]], [p[0], p[1], p[2] + s[2]]]);
        out.push(Placed { name: b.name.clone(), size: t, pos: p, inside: b.inside.clone() });
    }
    Some(out)
}

/// Fold small pieces into the boxes that can hold them, smallest holder first, so a chain of
/// boxes nests as a chain: each holder takes the biggest things (already carrying their own) it can fit.
fn nest(mut pool: Vec<Bundle>, pad: f64) -> Vec<Bundle> {
    pool.sort_by(|a, b| vol(a.dims).total_cmp(&vol(b.dims)));
    let mut i = 0;
    while i < pool.len() {
        if let Some(cav) = cavity(&pool[i]) {
            let mut kept: Vec<usize> = Vec::new();
            for j in (0..i).rev() {
                let mut trial: Vec<&Bundle> = kept.iter().map(|&k| &pool[k]).collect();
                trial.push(&pool[j]);
                if pack(&trial, cav, pad).is_some() { kept.push(j); }
            }
            if !kept.is_empty() {
                let placed = pack(&kept.iter().map(|&k| &pool[k]).collect::<Vec<_>>(), cav, pad).expect("packed a moment ago");
                let mut gone = kept.clone();
                gone.sort_unstable();
                pool[i].inside = placed;
                for &g in gone.iter().rev() { pool.remove(g); }
                i -= gone.len();
            }
        }
        i += 1;
    }
    pool
}

#[derive(Serialize)]
struct Verdict { name: String, fits: bool, /** share of the box's inside the top-level pieces use, 0 to 1 */ fill: f64 }

#[derive(Serialize)]
struct Piece { name: String, size: V3, inside: Vec<Placed> }

#[derive(Serialize)]
struct Output {
    /// In the order the boxes were given.
    boxes: Vec<Verdict>,
    /// Index of the smallest box everything fits in.
    best: Option<usize>,
    /// Where each top-level piece sits in the best box.
    packed: Vec<Placed>,
    /// What is left after nesting: the pieces that have to be placed in a box.
    pieces: Vec<Piece>,
    /// How many things went inside another.
    nested: usize,
}

fn positive(t: &Thing, what: &str) -> Result<(), String> {
    let ok = [t.l, t.w, t.h].iter().all(|d| d.is_finite() && *d > 0.0) && t.wall.is_finite() && t.wall >= 0.0;
    if ok { Ok(()) } else { Err(format!("{what} \"{}\" needs a positive length, width and height", t.name)) }
}

fn count(p: &[Placed]) -> usize { p.iter().map(|x| 1 + count(&x.inside)).sum() }

fn run(input: Input) -> Result<Output, String> {
    if !(input.pad.is_finite() && input.pad >= 0.0) { return Err("padding can't be negative".into()); }
    input.boxes.iter().try_for_each(|b| positive(b, "box"))?;
    input.items.iter().try_for_each(|b| positive(b, "item"))?;
    let total: usize = input.items.iter().map(|t| t.qty as usize).sum();
    if total > MAX_PIECES { return Err(format!("{total} pieces is more than the {MAX_PIECES} this checks at once")); }

    let pieces: Vec<Bundle> = input.items.iter()
        .flat_map(|t| std::iter::repeat_with(move || Bundle { name: t.name.clone(), dims: [t.l, t.w, t.h], wall: t.wall, inside: vec![] }).take(t.qty as usize))
        .collect();
    let pieces = nest(pieces, input.pad);
    let nested = pieces.iter().map(|p| count(&p.inside)).sum();
    let load: f64 = pieces.iter().map(|p| vol(p.dims)).sum();

    let mut by_size: Vec<usize> = (0..input.boxes.len()).collect();
    by_size.sort_by(|&a, &b| {
        let v = |i: usize| input.boxes[i].l * input.boxes[i].w * input.boxes[i].h;
        v(a).total_cmp(&v(b))
    });
    let refs: Vec<&Bundle> = pieces.iter().collect();
    let mut boxes: Vec<Verdict> = input.boxes.iter().map(|b| Verdict { name: b.name.clone(), fits: false, fill: 0.0 }).collect();
    let (mut best, mut packed) = (None, vec![]);
    for i in by_size {
        let b = &input.boxes[i];
        let cav = [b.l, b.w, b.h].map(|d| d - 2.0 * b.wall);
        if cav.iter().any(|&d| d <= EPS) { continue; }
        boxes[i].fill = load / vol(cav);
        if let Some(p) = pack(&refs, cav, input.pad) {
            boxes[i].fits = true;
            if best.is_none() { best = Some(i); packed = p; }
        }
    }
    let pieces = pieces.into_iter().map(|p| Piece { name: p.name, size: p.dims, inside: p.inside }).collect();
    Ok(Output { boxes, best, packed, pieces, nested })
}

/// `{ boxes, items, pad? }` in, `{ boxes, best, packed, pieces, nested }` out, or `{ error }`.
#[wasm_bindgen]
pub fn solve(json: &str) -> String {
    let out = serde_json::from_str::<Input>(json).map_err(|e| e.to_string()).and_then(run);
    match out {
        Ok(o) => serde_json::to_string(&o).unwrap(),
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}
