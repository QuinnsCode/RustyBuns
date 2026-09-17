//! Board analysis over tscircuit Circuit JSON.
//!
//! One job: take the JSON array tscircuit renders and report what a PCB
//! designer wants at a glance (size, connectivity, routing, copper) plus a
//! brute-force clearance check, which is the part that gets heavy on big
//! boards and the reason this lives in Rust.
//!
//! `src/analysis/analyze.ts` is a line-for-line twin. Tests hold them equal,
//! so the TS path is a real fallback, not a different answer.
//!
//! ABI (same exports for the cdylib and for wasm32):
//!   tsci_analyze(json_ptr, json_len, min_clearance_mm) -> *mut c_char  (NUL-terminated JSON)
//!   tsci_free(ptr)                                                     frees that string
//!   tsci_alloc(len) / tsci_dealloc(ptr, len)                           wasm: a buffer to write input into

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::ffi::CString;
use std::os::raw::c_char;

pub const MAX_VIOLATIONS: usize = 50;
pub const DEFAULT_VIA_DIAMETER: f64 = 0.6;
pub const DEFAULT_TRACE_WIDTH: f64 = 0.15;

// ---------- geometry (keep in lockstep with analyze.ts) ----------

fn len(x: f64, y: f64) -> f64 {
    (x * x + y * y).sqrt()
}

fn cross(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> f64 {
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

fn point_seg(px: f64, py: f64, s: &Seg) -> f64 {
    let dx = s.x2 - s.x1;
    let dy = s.y2 - s.y1;
    let l2 = dx * dx + dy * dy;
    if l2 == 0.0 {
        return len(px - s.x1, py - s.y1);
    }
    let mut t = ((px - s.x1) * dx + (py - s.y1) * dy) / l2;
    if t < 0.0 { t = 0.0; }
    if t > 1.0 { t = 1.0; }
    len(px - (s.x1 + t * dx), py - (s.y1 + t * dy))
}

fn crosses(a: &Seg, b: &Seg) -> bool {
    let d1 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
    let d2 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
    let d3 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
    let d4 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
    ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
}

fn seg_seg(a: &Seg, b: &Seg) -> f64 {
    if crosses(a, b) {
        return 0.0;
    }
    let mut d = point_seg(a.x1, a.y1, b);
    d = d.min(point_seg(a.x2, a.y2, b));
    d = d.min(point_seg(b.x1, b.y1, a));
    d.min(point_seg(b.x2, b.y2, a))
}

fn point_rect(px: f64, py: f64, r: &Pad) -> f64 {
    let dx = (r.minx - px).max(0.0).max(px - r.maxx);
    let dy = (r.miny - py).max(0.0).max(py - r.maxy);
    len(dx, dy)
}

fn seg_rect(s: &Seg, r: &Pad) -> f64 {
    let a = point_rect(s.x1, s.y1, r);
    let b = point_rect(s.x2, s.y2, r);
    if a == 0.0 || b == 0.0 {
        return 0.0;
    }
    let edges = [
        Seg::line(r.minx, r.miny, r.maxx, r.miny),
        Seg::line(r.maxx, r.miny, r.maxx, r.maxy),
        Seg::line(r.maxx, r.maxy, r.minx, r.maxy),
        Seg::line(r.minx, r.maxy, r.minx, r.miny),
    ];
    let mut d = a.min(b);
    for e in edges.iter() {
        if crosses(s, e) {
            return 0.0;
        }
        d = d.min(point_seg(e.x1, e.y1, s));
    }
    d
}

fn r6(x: f64) -> f64 {
    // floor(x+0.5), not round(): JS Math.round and Rust round disagree on negative halves.
    ((x * 1e6) + 0.5).floor() / 1e6
}

// ---------- model ----------

struct Seg { x1: f64, y1: f64, x2: f64, y2: f64, hw: f64, layer: String, group: i64, id: String }

impl Seg {
    fn line(x1: f64, y1: f64, x2: f64, y2: f64) -> Seg {
        Seg { x1, y1, x2, y2, hw: 0.0, layer: String::new(), group: 0, id: String::new() }
    }
}

struct Pad { minx: f64, maxx: f64, miny: f64, maxy: f64, circle: Option<(f64, f64, f64)>, layer: String, group: i64, id: String }

struct Uf { p: Vec<usize> }
impl Uf {
    fn find(&mut self, mut i: usize) -> usize {
        while self.p[i] != i { self.p[i] = self.p[self.p[i]]; i = self.p[i]; }
        i
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb { let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) }; self.p[hi] = lo; }
    }
}

fn s<'a>(e: &'a Value, k: &str) -> &'a str { e.get(k).and_then(Value::as_str).unwrap_or("") }
fn f(e: &Value, k: &str) -> Option<f64> { e.get(k).and_then(Value::as_f64) }

fn of_type<'a>(els: &'a [Value], t: &'static str) -> impl Iterator<Item = &'a Value> + 'a {
    els.iter().filter(move |e| s(e, "type") == t)
}

#[derive(Default)]
struct Violation { a: String, b: String, gap: f64 }

/// Pure entry point. `elements` is the Circuit JSON array.
pub fn analyze(elements: &[Value], min_clearance: f64) -> Value {
    let by_type = |t: &'static str| of_type(elements, t);

    // board
    let board = by_type("pcb_board").next();
    let (bw, bh) = board.map(|b| (f(b, "width").unwrap_or(0.0), f(b, "height").unwrap_or(0.0))).unwrap_or((0.0, 0.0));
    let layers = board.and_then(|b| f(b, "num_layers")).unwrap_or(2.0);
    let mut area = bw * bh;
    if let Some(outline) = board.and_then(|b| b.get("outline")).and_then(Value::as_array) {
        if outline.len() >= 3 {
            let mut a = 0.0;
            for i in 0..outline.len() {
                let p = &outline[i];
                let q = &outline[(i + 1) % outline.len()];
                a += f(p, "x").unwrap_or(0.0) * f(q, "y").unwrap_or(0.0) - f(q, "x").unwrap_or(0.0) * f(p, "y").unwrap_or(0.0);
            }
            area = (a / 2.0).abs();
        }
    }

    // connectivity: ports first, then nets, in element order
    let ports: Vec<&Value> = by_type("source_port").collect();
    let nets: Vec<&Value> = by_type("source_net").collect();
    let mut node: HashMap<String, usize> = HashMap::new();
    for (i, p) in ports.iter().enumerate() { node.insert(format!("port:{}", s(p, "source_port_id")), i); }
    for (i, n) in nets.iter().enumerate() { node.insert(format!("net:{}", s(n, "source_net_id")), ports.len() + i); }
    let mut uf = Uf { p: (0..ports.len() + nets.len()).collect() };
    let mut trace_first_node: HashMap<String, usize> = HashMap::new();
    for t in by_type("source_trace") {
        let mut ids: Vec<usize> = Vec::new();
        for k in ["connected_source_port_ids", "connected_source_net_ids"] {
            let prefix = if k.contains("port") { "port:" } else { "net:" };
            for id in t.get(k).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                if let Some(&n) = node.get(&format!("{prefix}{id}")) { ids.push(n); }
            }
        }
        if let Some(&first) = ids.first() {
            for &n in &ids[1..] { uf.union(first, n); }
            trace_first_node.insert(s(t, "source_trace_id").to_string(), first);
        }
    }
    let comp_name: HashMap<&str, &str> = by_type("source_component").map(|c| (s(c, "source_component_id"), s(c, "name"))).collect();
    let mut group_ports: HashMap<usize, usize> = HashMap::new();
    let mut group_name: HashMap<usize, String> = HashMap::new();
    for (i, n) in nets.iter().enumerate() {
        let g = uf.find(ports.len() + i);
        group_name.entry(g).or_insert_with(|| s(n, "name").to_string());
    }
    for (i, p) in ports.iter().enumerate() {
        let g = uf.find(i);
        *group_ports.entry(g).or_insert(0) += 1;
        group_name.entry(g).or_insert_with(|| format!("{}.{}", comp_name.get(s(p, "source_component_id")).copied().unwrap_or("?"), s(p, "name")));
    }
    let pcb_to_source: HashMap<&str, &str> = by_type("pcb_port").map(|p| (s(p, "pcb_port_id"), s(p, "source_port_id"))).collect();
    let group_of_pcb_port = |id: &str, uf: &mut Uf| -> Option<i64> {
        let sp = pcb_to_source.get(id)?;
        let n = *node.get(&format!("port:{sp}"))?;
        Some(uf.find(n) as i64)
    };

    // traces -> segments
    let mut segs: Vec<Seg> = Vec::new();
    let mut total_len = 0.0;
    let mut by_layer: Map<String, Value> = Map::new();
    let mut layer_len: Vec<(String, f64)> = Vec::new();
    let mut trace_area = 0.0;
    let mut min_width = f64::INFINITY;
    let mut vias = 0usize;
    let mut via_area = 0.0;
    let mut group_len: HashMap<i64, f64> = HashMap::new();
    let mut pcb_traces = 0usize;
    for (ti, t) in by_type("pcb_trace").enumerate() {
        pcb_traces += 1;
        let route: Vec<&Value> = t.get("route").and_then(Value::as_array).map(|r| r.iter().collect()).unwrap_or_default();
        let mut port_ids: Vec<&str> = t.get("connectsTo").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
        for p in &route {
            for k in ["start_pcb_port_id", "end_pcb_port_id"] { if let Some(id) = p.get(k).and_then(Value::as_str) { port_ids.push(id); } }
        }
        let mut group: Option<i64> = None;
        for id in &port_ids { if let Some(g) = group_of_pcb_port(id, &mut uf) { group = Some(g); break; } }
        if group.is_none() {
            let cn = s(t, "connection_name");
            let n = node.get(&format!("net:{cn}")).copied().or_else(|| trace_first_node.get(cn).copied());
            group = n.map(|n| uf.find(n) as i64);
        }
        let group = group.unwrap_or(-(ti as i64) - 1);
        let id = s(t, "pcb_trace_id").to_string();
        for p in &route {
            if s(p, "route_type") == "via" {
                vias += 1;
                let d = DEFAULT_VIA_DIAMETER;
                via_area += std::f64::consts::PI * (d / 2.0) * (d / 2.0);
            }
        }
        for w in route.windows(2) {
            let (a, b) = (w[0], w[1]);
            if s(a, "route_type") != "wire" || s(b, "route_type") != "wire" { continue; }
            if s(a, "layer") != s(b, "layer") { continue; }
            let (Some(x1), Some(y1), Some(x2), Some(y2)) = (f(a, "x"), f(a, "y"), f(b, "x"), f(b, "y")) else { continue };
            let width = f(a, "width").unwrap_or(DEFAULT_TRACE_WIDTH);
            let l = len(x2 - x1, y2 - y1);
            total_len += l;
            trace_area += l * width;
            if width < min_width { min_width = width; }
            let layer = s(a, "layer").to_string();
            match layer_len.iter_mut().find(|(k, _)| *k == layer) { Some(e) => e.1 += l, None => layer_len.push((layer.clone(), l)) }
            *group_len.entry(group).or_insert(0.0) += l;
            segs.push(Seg { x1, y1, x2, y2, hw: width / 2.0, layer, group, id: id.clone() });
        }
    }
    for v in by_type("pcb_via") {
        vias += 1;
        let d = f(v, "outer_diameter").unwrap_or(DEFAULT_VIA_DIAMETER);
        via_area += std::f64::consts::PI * (d / 2.0) * (d / 2.0);
    }
    for (k, v) in &layer_len { by_layer.insert(k.clone(), json!(r6(*v))); }

    // pads
    let mut pads: Vec<Pad> = Vec::new();
    let mut pad_area = 0.0;
    for (pi, p) in by_type("pcb_smtpad").enumerate() {
        let (x, y) = (f(p, "x").unwrap_or(0.0), f(p, "y").unwrap_or(0.0));
        let group = group_of_pcb_port(s(p, "pcb_port_id"), &mut uf).unwrap_or(-1_000_000 - pi as i64);
        let layer = s(p, "layer").to_string();
        let id = s(p, "pcb_smtpad_id").to_string();
        let shape = s(p, "shape");
        if shape == "circle" {
            let r = f(p, "radius").unwrap_or(0.0);
            pad_area += std::f64::consts::PI * r * r;
            pads.push(Pad { minx: x - r, maxx: x + r, miny: y - r, maxy: y + r, circle: Some((x, y, r)), layer, group, id });
        } else if let (Some(w), Some(h)) = (f(p, "width"), f(p, "height")) {
            pad_area += w * h;
            pads.push(Pad { minx: x - w / 2.0, maxx: x + w / 2.0, miny: y - h / 2.0, maxy: y + h / 2.0, circle: None, layer, group, id });
        }
    }

    // clearance: every segment vs every later segment and every pad, other nets, same layer
    let check = |i: usize| -> (u64, f64, Vec<Violation>) {
        let a = &segs[i];
        let (mut n, mut min, mut out) = (0u64, f64::INFINITY, Vec::new());
        for b in &segs[i + 1..] {
            if b.layer != a.layer || b.group == a.group { continue; }
            n += 1;
            let gap = seg_seg(a, b) - a.hw - b.hw;
            if gap < min { min = gap; }
            if gap < min_clearance { out.push(Violation { a: a.id.clone(), b: b.id.clone(), gap }); }
        }
        for p in &pads {
            if p.layer != a.layer || p.group == a.group { continue; }
            n += 1;
            let gap = match p.circle {
                Some((cx, cy, r)) => point_seg(cx, cy, a) - r - a.hw,
                None => seg_rect(a, p) - a.hw,
            };
            if gap < min { min = gap; }
            if gap < min_clearance { out.push(Violation { a: a.id.clone(), b: p.id.clone(), gap }); }
        }
        (n, min, out)
    };

    #[cfg(feature = "parallel")]
    let results: Vec<(u64, f64, Vec<Violation>)> = {
        use rayon::prelude::*;
        (0..segs.len()).into_par_iter().map(check).collect()
    };
    #[cfg(not(feature = "parallel"))]
    let results: Vec<(u64, f64, Vec<Violation>)> = (0..segs.len()).map(check).collect();

    let mut checked = 0u64;
    let mut min_gap = f64::INFINITY;
    let mut viols: Vec<Violation> = Vec::new();
    for (n, m, v) in results { checked += n; if m < min_gap { min_gap = m; } viols.extend(v); }
    viols.sort_by(|x, y| x.gap.partial_cmp(&y.gap).unwrap().then_with(|| x.a.cmp(&y.a)).then_with(|| x.b.cmp(&y.b)));
    let total_viol = viols.len();
    viols.truncate(MAX_VIOLATIONS);

    // nets: every group with 2+ ports
    let mut net_rows: Vec<(String, usize, f64)> = group_ports.iter().filter(|(_, &c)| c >= 2)
        .map(|(g, &c)| (group_name[g].clone(), c, *group_len.get(&(*g as i64)).unwrap_or(&0.0))).collect();
    let unrouted = net_rows.iter().filter(|r| r.2 == 0.0).count();
    net_rows.sort_by(|x, y| y.2.partial_cmp(&x.2).unwrap().then_with(|| x.0.cmp(&y.0)));
    let net_count = net_rows.len();
    net_rows.truncate(10);

    let copper = trace_area + pad_area + via_area;
    json!({
        "board": { "width_mm": r6(bw), "height_mm": r6(bh), "area_mm2": r6(area), "layers": layers },
        "counts": {
            "components": by_type("source_component").count(),
            "ports": ports.len(),
            "nets": net_count,
            "pads": pads.len(),
            "pcb_traces": pcb_traces,
            "segments": segs.len(),
            "vias": vias,
        },
        "routing": {
            "total_length_mm": r6(total_len),
            "by_layer_mm": Value::Object(by_layer),
            "min_width_mm": if min_width.is_finite() { json!(r6(min_width)) } else { Value::Null },
            "unrouted_nets": unrouted,
        },
        "copper": {
            "trace_mm2": r6(trace_area), "pad_mm2": r6(pad_area), "via_mm2": r6(via_area),
            "total_mm2": r6(copper),
            "density_pct": if area > 0.0 { json!(r6(copper / area * 100.0)) } else { Value::Null },
        },
        "longest_nets": net_rows.iter().map(|(n, c, l)| json!({ "name": n, "ports": c, "length_mm": r6(*l) })).collect::<Vec<_>>(),
        "clearance": {
            "min_clearance_mm": min_clearance,
            "pairs_checked": checked,
            "min_gap_mm": if min_gap.is_finite() { json!(r6(min_gap)) } else { Value::Null },
            "violation_count": total_viol,
            "violations": viols.iter().map(|v| json!({ "a": v.a, "b": v.b, "gap_mm": r6(v.gap) })).collect::<Vec<_>>(),
        },
    })
}

fn to_c(v: Value) -> *mut c_char {
    CString::new(v.to_string()).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `ptr` must point to `len` readable bytes of UTF-8 JSON. The caller owns them.
/// The returned string is owned by Rust: give it back with `tsci_free`.
#[no_mangle]
pub unsafe extern "C" fn tsci_analyze(ptr: *const u8, len: usize, min_clearance: f64) -> *mut c_char {
    if ptr.is_null() { return to_c(json!({ "error": "null input" })); }
    let bytes = std::slice::from_raw_parts(ptr, len);
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Array(a)) => to_c(analyze(&a, min_clearance)),
        Ok(_) => to_c(json!({ "error": "expected a Circuit JSON array" })),
        Err(e) => to_c(json!({ "error": format!("bad json: {e}") })),
    }
}

/// # Safety
/// `p` must come from `tsci_analyze` and be freed once.
#[no_mangle]
pub unsafe extern "C" fn tsci_free(p: *mut c_char) {
    if !p.is_null() { drop(CString::from_raw(p)); }
}

/// wasm helper: a buffer the JS side writes the input JSON into.
#[no_mangle]
pub extern "C" fn tsci_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p`/`len` must come from `tsci_alloc`.
#[no_mangle]
pub unsafe extern "C" fn tsci_dealloc(p: *mut u8, len: usize) {
    if !p.is_null() { drop(Vec::from_raw_parts(p, 0, len)); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire(x: f64, y: f64) -> Value { json!({ "route_type": "wire", "x": x, "y": y, "width": 0.2, "layer": "top" }) }

    #[test]
    fn close_traces_on_different_nets_are_flagged() {
        let els = vec![
            json!({ "type": "pcb_board", "width": 10, "height": 10 }),
            json!({ "type": "pcb_trace", "pcb_trace_id": "t1", "route": [wire(0.0, 0.0), wire(5.0, 0.0)] }),
            json!({ "type": "pcb_trace", "pcb_trace_id": "t2", "route": [wire(0.0, 0.25), wire(5.0, 0.25)] }),
        ];
        let r = analyze(&els, 0.1);
        assert_eq!(r["clearance"]["violation_count"], 1);
        assert_eq!(r["clearance"]["min_gap_mm"], 0.05);
        assert_eq!(r["routing"]["total_length_mm"], 10.0);
    }

    #[test]
    fn crossing_traces_have_zero_gap() {
        let a = Seg::line(0.0, 0.0, 2.0, 2.0);
        let b = Seg::line(0.0, 2.0, 2.0, 0.0);
        assert_eq!(seg_seg(&a, &b), 0.0);
    }
}
