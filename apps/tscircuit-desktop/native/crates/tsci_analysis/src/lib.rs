//! Board analysis over tscircuit Circuit JSON.
//!
//! One job: take the JSON array tscircuit renders and report what a PCB
//! designer wants at a glance (size, connectivity, routing, copper) plus a
//! clearance check through a spatial index, run across every core: the part
//! that gets heavy on big boards and the reason this lives in Rust.
//!
//! `src/analysis/analyze.ts` is a line-for-line twin. Tests hold them equal,
//! so the TS path is a real fallback, not a different answer.
//!
//! ABI (same exports for the cdylib and for wasm32):
//!   tsci_analyze(json_ptr, json_len, min_clearance_mm) -> *mut c_char  (NUL-terminated JSON)
//!   tsci_analyze_async(json_ptr, json_len, min, id, done)              native only: on a Rust thread,
//!                                                                      then done(id, result)
//!   tsci_free(ptr)                                                     frees that string
//!   tsci_alloc(len) / tsci_dealloc(ptr, len)                           wasm: a buffer to write input into

mod parse;

pub use parse::{Element, Top};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::ffi::CString;
use std::os::raw::c_char;

pub const MAX_VIOLATIONS: usize = 50;
pub const DEFAULT_VIA_DIAMETER: f64 = 0.6;
pub const DEFAULT_TRACE_WIDTH: f64 = 0.15;
/// First search radius for the clearance check. Real boards' closest gaps are well under it.
pub const SEARCH_START_MM: f64 = 1.0;
/// Slack on index queries so a pair right at the radius is never lost to rounding.
const EPS: f64 = 1e-9;

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

// ---------- spatial index (keep in lockstep with analyze.ts) ----------

/// Uniform grid over item bounding boxes (segments inflated by their half-width,
/// pads as-is). An item sits in every cell its box touches.
struct Grid { minx: f64, miny: f64, cell: f64, nx: usize, ny: usize, cells: Vec<Vec<u32>>, spans: Vec<(usize, usize, usize, usize)> }

impl Grid {
    fn new(boxes: &[[f64; 4]], search: f64) -> Grid {
        let (mut minx, mut miny, mut maxx, mut maxy) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for b in boxes {
            minx = minx.min(b[0]); miny = miny.min(b[1]);
            maxx = maxx.max(b[2]); maxy = maxy.max(b[3]);
        }
        let n = boxes.len().max(1) as f64;
        let w = (maxx - minx).max(0.0);
        let h = (maxy - miny).max(0.0);
        // ~one item per cell, never thinner than a line's worth, never below the radius.
        let cell = (w * h / n).sqrt().max((w + h) / n).max(search).max(0.01);
        let nx = (w / cell).floor() as usize + 1;
        let ny = (h / cell).floor() as usize + 1;
        let mut g = Grid { minx, miny, cell, nx, ny, cells: vec![Vec::new(); nx * ny], spans: Vec::with_capacity(boxes.len()) };
        for (k, b) in boxes.iter().enumerate() {
            let (x0, x1, y0, y1) = g.range(b[0], b[1], b[2], b[3]);
            for cy in y0..=y1 { for cx in x0..=x1 { g.cells[cy * nx + cx].push(k as u32); } }
            g.spans.push((x0, x1, y0, y1));
        }
        g
    }

    fn ix(&self, v: f64, lo: f64, n: usize) -> usize {
        let i = ((v - lo) / self.cell).floor();
        if i < 0.0 { 0 } else if i >= (n - 1) as f64 { n - 1 } else { i as usize }
    }

    fn range(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> (usize, usize, usize, usize) {
        (self.ix(x0, self.minx, self.nx), self.ix(x1, self.minx, self.nx), self.ix(y0, self.miny, self.ny), self.ix(y1, self.miny, self.ny))
    }

    /// Calls `f` once for each item whose cells meet the box. An item shares
    /// several cells with the query; it is visited only in the first of them
    /// (lowest x, then lowest y), so no "seen" set is needed.
    fn query(&self, x0: f64, y0: f64, x1: f64, y1: f64, mut f: impl FnMut(usize)) {
        let (cx0, cx1, cy0, cy1) = self.range(x0, y0, x1, y1);
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                for &k in &self.cells[cy * self.nx + cx] {
                    let (kx0, _, ky0, _) = self.spans[k as usize];
                    if cx == cx0.max(kx0) && cy == cy0.max(ky0) { f(k as usize); }
                }
            }
        }
    }
}

fn seg_box(s: &Seg) -> [f64; 4] {
    [s.x1.min(s.x2) - s.hw, s.y1.min(s.y2) - s.hw, s.x1.max(s.x2) + s.hw, s.y1.max(s.y2) + s.hw]
}

/// Width plus height of everything: a radius this big makes every pair a candidate.
fn extent(segs: &[Seg], pads: &[Pad]) -> f64 {
    let (mut minx, mut miny, mut maxx, mut maxy) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    let boxes = segs.iter().map(seg_box).chain(pads.iter().map(|p| [p.minx, p.miny, p.maxx, p.maxy]));
    for b in boxes { minx = minx.min(b[0]); miny = miny.min(b[1]); maxx = maxx.max(b[2]); maxy = maxy.max(b[3]); }
    if minx > maxx { 0.0 } else { (maxx - minx) + (maxy - miny) }
}

/// One pass: every pair whose copper is within `search` of each other is measured.
fn clearance_pass<'a>(segs: &[Seg<'a>], pads: &[Pad<'a>], min_clearance: f64, search: f64) -> (u64, f64, Vec<Violation<'a>>) {
    let boxes: Vec<[f64; 4]> = segs.iter().map(seg_box).chain(pads.iter().map(|p| [p.minx, p.miny, p.maxx, p.maxy])).collect();
    let grid = Grid::new(&boxes, search);
    let ns = segs.len();
    let check = |i: usize| -> (u64, f64, Vec<Violation<'a>>) {
        let a = &segs[i];
        let q = a.hw + search + EPS;
        let b = &boxes[i];
        let (mut n, mut min, mut out) = (0u64, f64::INFINITY, Vec::new());
        grid.query(b[0] - q, b[1] - q, b[2] + q, b[3] + q, |k| {
            let (gap, id, group) = if k < ns {
                if k <= i { return; }
                let o = &segs[k];
                if o.layer != a.layer || o.group == a.group { return; }
                (seg_seg(a, o) - a.hw - o.hw, o.id, o.group)
            } else {
                let p = &pads[k - ns];
                if p.layer != a.layer || p.group == a.group { return; }
                let gap = match p.circle {
                    Some((cx, cy, r)) => point_seg(cx, cy, a) - r - a.hw,
                    None => seg_rect(a, p) - a.hw,
                };
                (gap, p.id, p.group)
            };
            n += 1;
            if gap < min { min = gap; }
            if gap < min_clearance { out.push(Violation { a: a.id, b: id, gap, ga: a.group, gb: group }); }
        });
        (n, min, out)
    };

    #[cfg(feature = "parallel")]
    let results: Vec<(u64, f64, Vec<Violation<'a>>)> = {
        use rayon::prelude::*;
        (0..ns).into_par_iter().map(check).collect()
    };
    #[cfg(not(feature = "parallel"))]
    let results: Vec<(u64, f64, Vec<Violation<'a>>)> = (0..ns).map(check).collect();

    let (mut checked, mut min_gap, mut viols) = (0u64, f64::INFINITY, Vec::new());
    for (n, m, v) in results { checked += n; if m < min_gap { min_gap = m; } viols.extend(v); }
    (checked, min_gap, viols)
}

/// What brute force would measure: same-layer, other-net pairs, counted per layer and net.
fn pairs_possible(segs: &[Seg], pads: &[Pad]) -> u64 {
    let mut layer: HashMap<&str, (u64, u64)> = HashMap::new();
    let mut net: HashMap<(&str, i64), (u64, u64)> = HashMap::new();
    for s in segs { layer.entry(s.layer).or_default().0 += 1; net.entry((s.layer, s.group)).or_default().0 += 1; }
    for p in pads { layer.entry(p.layer).or_default().1 += 1; net.entry((p.layer, p.group)).or_default().1 += 1; }
    let pairs = |&(s, p): &(u64, u64)| s * s.saturating_sub(1) / 2 + s * p;
    layer.values().map(pairs).sum::<u64>() - net.values().map(pairs).sum::<u64>()
}

fn r6(x: f64) -> f64 {
    // floor(x+0.5), not round(): JS Math.round and Rust round disagree on negative halves.
    ((x * 1e6) + 0.5).floor() / 1e6
}

// ---------- model ----------

struct Seg<'a> { x1: f64, y1: f64, x2: f64, y2: f64, hw: f64, layer: &'a str, group: i64, id: &'a str }

impl Seg<'static> {
    fn line(x1: f64, y1: f64, x2: f64, y2: f64) -> Seg<'static> {
        Seg { x1, y1, x2, y2, hw: 0.0, layer: "", group: 0, id: "" }
    }
}

struct Pad<'a> { minx: f64, maxx: f64, miny: f64, maxy: f64, circle: Option<(f64, f64, f64)>, layer: &'a str, group: i64, id: &'a str }

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

struct Violation<'a> { a: &'a str, b: &'a str, gap: f64, ga: i64, gb: i64 }

/// The element types the analysis reads, each in element order. One pass.
#[derive(Default)]
struct ByType<'e, 'a> {
    board: Option<&'e Element<'a>>,
    ports: Vec<&'e Element<'a>>,
    nets: Vec<&'e Element<'a>>,
    traces: Vec<&'e Element<'a>>,
    components: Vec<&'e Element<'a>>,
    pcb_ports: Vec<&'e Element<'a>>,
    pcb_traces: Vec<&'e Element<'a>>,
    vias: Vec<&'e Element<'a>>,
    pads: Vec<&'e Element<'a>>,
}

fn by_type<'e, 'a>(elements: &'e [Element<'a>]) -> ByType<'e, 'a> {
    let mut t = ByType::default();
    for e in elements {
        match e.kind.get() {
            "pcb_board" => { t.board.get_or_insert(e); }
            "source_port" => t.ports.push(e),
            "source_net" => t.nets.push(e),
            "source_trace" => t.traces.push(e),
            "source_component" => t.components.push(e),
            "pcb_port" => t.pcb_ports.push(e),
            "pcb_trace" => t.pcb_traces.push(e),
            "pcb_via" => t.vias.push(e),
            "pcb_smtpad" => t.pads.push(e),
            _ => {}
        }
    }
    t
}

/// Pure entry point. `elements` is the Circuit JSON array, parsed by `parse`.
pub fn analyze(elements: &[Element], min_clearance: f64) -> Value {
    let by = by_type(elements);

    // board
    let board = by.board;
    let (bw, bh) = board.map(|b| (b.width.0.unwrap_or(0.0), b.height.0.unwrap_or(0.0))).unwrap_or((0.0, 0.0));
    let layers = board.and_then(|b| b.num_layers.0).unwrap_or(2.0);
    let mut area = bw * bh;
    if let Some(outline) = board.map(|b| &b.outline.0) {
        if outline.len() >= 3 {
            let mut a = 0.0;
            for i in 0..outline.len() {
                let p = &outline[i];
                let q = &outline[(i + 1) % outline.len()];
                a += p.x.0.unwrap_or(0.0) * q.y.0.unwrap_or(0.0) - q.x.0.unwrap_or(0.0) * p.y.0.unwrap_or(0.0);
            }
            area = (a / 2.0).abs();
        }
    }

    // connectivity: ports first, then nets, in element order
    let (ports, nets) = (&by.ports, &by.nets);
    let mut port_node: HashMap<&str, usize> = HashMap::new();
    let mut net_node: HashMap<&str, usize> = HashMap::new();
    for (i, p) in ports.iter().enumerate() { port_node.insert(p.source_port_id.get(), i); }
    for (i, n) in nets.iter().enumerate() { net_node.insert(n.source_net_id.get(), ports.len() + i); }
    let mut uf = Uf { p: (0..ports.len() + nets.len()).collect() };
    let mut trace_first_node: HashMap<&str, usize> = HashMap::new();
    for t in &by.traces {
        let mut ids: Vec<usize> = Vec::new();
        for id in t.connected_source_port_ids.0.iter().filter_map(|s| s.0.as_deref()) {
            if let Some(&n) = port_node.get(id) { ids.push(n); }
        }
        for id in t.connected_source_net_ids.0.iter().filter_map(|s| s.0.as_deref()) {
            if let Some(&n) = net_node.get(id) { ids.push(n); }
        }
        if let Some(&first) = ids.first() {
            for &n in &ids[1..] { uf.union(first, n); }
            trace_first_node.insert(t.source_trace_id.get(), first);
        }
    }
    let comp_name: HashMap<&str, &str> = by.components.iter().map(|c| (c.source_component_id.get(), c.name.get())).collect();
    let mut group_ports: HashMap<usize, usize> = HashMap::new();
    let mut group_name: HashMap<usize, String> = HashMap::new();
    for (i, n) in nets.iter().enumerate() {
        let g = uf.find(ports.len() + i);
        group_name.entry(g).or_insert_with(|| n.name.get().to_string());
    }
    for (i, p) in ports.iter().enumerate() {
        let g = uf.find(i);
        *group_ports.entry(g).or_insert(0) += 1;
        group_name.entry(g).or_insert_with(|| format!("{}.{}", comp_name.get(p.source_component_id.get()).copied().unwrap_or("?"), p.name.get()));
    }
    let pcb_to_source: HashMap<&str, &str> = by.pcb_ports.iter().map(|p| (p.pcb_port_id.get(), p.source_port_id.get())).collect();
    let group_of_pcb_port = |id: &str, uf: &mut Uf| -> Option<i64> {
        let sp = pcb_to_source.get(id)?;
        let n = *port_node.get(sp)?;
        Some(uf.find(n) as i64)
    };

    // traces -> segments
    let mut segs: Vec<Seg> = Vec::new();
    let mut total_len = 0.0;
    let mut by_layer: Map<String, Value> = Map::new();
    let mut layer_len: Vec<(&str, f64)> = Vec::new();
    let mut trace_area = 0.0;
    let mut min_width = f64::INFINITY;
    let mut vias = 0usize;
    let mut via_area = 0.0;
    let mut group_len: HashMap<i64, f64> = HashMap::new();
    let pcb_traces = by.pcb_traces.len();
    for (ti, t) in by.pcb_traces.iter().enumerate() {
        let route = &t.route.0;
        let mut group: Option<i64> = None;
        let port_ids = t.connects_to.0.iter().map(|s| &s.0)
            .chain(route.iter().flat_map(|p| [&p.start_pcb_port_id.0, &p.end_pcb_port_id.0]));
        for id in port_ids.filter_map(|s| s.as_deref()) { if let Some(g) = group_of_pcb_port(id, &mut uf) { group = Some(g); break; } }
        if group.is_none() {
            let cn = t.connection_name.get();
            let n = net_node.get(cn).copied().or_else(|| trace_first_node.get(cn).copied());
            group = n.map(|n| uf.find(n) as i64);
        }
        let group = group.unwrap_or(-(ti as i64) - 1);
        let id = t.pcb_trace_id.get();
        for p in route {
            if p.route_type.get() == "via" {
                vias += 1;
                let d = DEFAULT_VIA_DIAMETER;
                via_area += std::f64::consts::PI * (d / 2.0) * (d / 2.0);
            }
        }
        for w in route.windows(2) {
            let (a, b) = (&w[0], &w[1]);
            if a.route_type.get() != "wire" || b.route_type.get() != "wire" { continue; }
            if a.layer.get() != b.layer.get() { continue; }
            let (Some(x1), Some(y1), Some(x2), Some(y2)) = (a.x.0, a.y.0, b.x.0, b.y.0) else { continue };
            let width = a.width.0.unwrap_or(DEFAULT_TRACE_WIDTH);
            let l = len(x2 - x1, y2 - y1);
            total_len += l;
            trace_area += l * width;
            if width < min_width { min_width = width; }
            let layer = a.layer.get();
            match layer_len.iter_mut().find(|(k, _)| *k == layer) { Some(e) => e.1 += l, None => layer_len.push((layer, l)) }
            *group_len.entry(group).or_insert(0.0) += l;
            segs.push(Seg { x1, y1, x2, y2, hw: width / 2.0, layer, group, id });
        }
    }
    for v in &by.vias {
        vias += 1;
        let d = v.outer_diameter.0.unwrap_or(DEFAULT_VIA_DIAMETER);
        via_area += std::f64::consts::PI * (d / 2.0) * (d / 2.0);
    }
    for (k, v) in &layer_len { by_layer.insert(k.to_string(), json!(r6(*v))); }

    // pads
    let mut pads: Vec<Pad> = Vec::new();
    let mut pad_area = 0.0;
    for (pi, p) in by.pads.iter().enumerate() {
        let (x, y) = (p.x.0.unwrap_or(0.0), p.y.0.unwrap_or(0.0));
        let group = group_of_pcb_port(p.pcb_port_id.get(), &mut uf).unwrap_or(-1_000_000 - pi as i64);
        let (layer, id) = (p.layer.get(), p.pcb_smtpad_id.get());
        if p.shape.get() == "circle" {
            let r = p.radius.0.unwrap_or(0.0);
            pad_area += std::f64::consts::PI * r * r;
            pads.push(Pad { minx: x - r, maxx: x + r, miny: y - r, maxy: y + r, circle: Some((x, y, r)), layer, group, id });
        } else if let (Some(w), Some(h)) = (p.width.0, p.height.0) {
            pad_area += w * h;
            pads.push(Pad { minx: x - w / 2.0, maxx: x + w / 2.0, miny: y - h / 2.0, maxy: y + h / 2.0, circle: None, layer, group, id });
        }
    }

    // clearance: segment vs later segments and pads, other nets, same layer, through
    // the spatial index. It is exact: pairs within the search radius are all found,
    // so the radius only grows (x4) when the closest gap could lie beyond it.
    let mut search = min_clearance.max(SEARCH_START_MM);
    let span = extent(&segs, &pads);
    let (checked, min_gap, mut viols) = loop {
        let (n, m, v) = clearance_pass(&segs, &pads, min_clearance, search);
        if m < search || search >= span { break (n, m, v); }
        search *= 4.0;
    };
    viols.sort_by(|x, y| x.gap.partial_cmp(&y.gap).unwrap().then_with(|| x.a.cmp(&y.a)).then_with(|| x.b.cmp(&y.b)));
    let total_viol = viols.len();
    viols.truncate(MAX_VIOLATIONS);
    let net_of = |g: i64| -> Option<String> { if g >= 0 { group_name.get(&(g as usize)).cloned() } else { None } };

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
            "components": by.components.len(),
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
            "pairs_possible": pairs_possible(&segs, &pads),
            "search_radius_mm": search,
            "min_gap_mm": if min_gap.is_finite() { json!(r6(min_gap)) } else { Value::Null },
            "violation_count": total_viol,
            "violations": viols.iter().map(|v| json!({ "a": v.a, "b": v.b, "gap_mm": r6(v.gap), "net_a": net_of(v.ga), "net_b": net_of(v.gb) })).collect::<Vec<_>>(),
        },
    })
}

fn to_c(v: Value) -> *mut c_char {
    CString::new(v.to_string()).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// Circuit JSON bytes in, analysis (or `{"error": ...}`) out. Never panics into the caller.
fn analyze_bytes(bytes: &[u8], min_clearance: f64) -> *mut c_char {
    match serde_json::from_slice::<parse::Top>(bytes) {
        // A panic must not unwind into Bun: that aborts the whole app. Report it instead.
        Ok(parse::Top(Some(a))) => match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| analyze(&a, min_clearance))) {
            Ok(v) => to_c(v),
            Err(_) => to_c(json!({ "error": "analysis panicked" })),
        },
        Ok(parse::Top(None)) => to_c(json!({ "error": "expected a Circuit JSON array" })),
        Err(e) => to_c(json!({ "error": format!("bad json: {e}") })),
    }
}

/// # Safety
/// `ptr` must point to `len` readable bytes of UTF-8 JSON. The caller owns them.
/// The returned string is owned by Rust: give it back with `tsci_free`.
#[no_mangle]
pub unsafe extern "C" fn tsci_analyze(ptr: *const u8, len: usize, min_clearance: f64) -> *mut c_char {
    if ptr.is_null() { return to_c(json!({ "error": "null input" })); }
    analyze_bytes(std::slice::from_raw_parts(ptr, len), min_clearance)
}

/// Called once per `tsci_analyze_async`, from a Rust thread, with the caller's id
/// and a result string to give back with `tsci_free`.
pub type Done = extern "C" fn(id: u32, out: *mut c_char);

/// Like `tsci_analyze`, but returns at once: the input is copied and analyzed on
/// its own thread, so the caller's event loop keeps serving while it runs.
/// Bun side: a `JSCallback` with `threadsafe: true`.
///
/// # Safety
/// `ptr`/`len` as for `tsci_analyze` (read before this returns); `done` must stay
/// callable until it has been called.
#[cfg(not(target_arch = "wasm32"))]
#[no_mangle]
pub unsafe extern "C" fn tsci_analyze_async(ptr: *const u8, len: usize, min_clearance: f64, id: u32, done: Done) {
    let bytes = if ptr.is_null() { Vec::new() } else { std::slice::from_raw_parts(ptr, len).to_vec() };
    std::thread::spawn(move || done(id, analyze_bytes(&bytes, min_clearance)));
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
        let text = serde_json::to_vec(&els).unwrap();
        let parse::Top(Some(els)) = serde_json::from_slice(&text).unwrap() else { panic!("not an array") };
        let r = analyze(&els, 0.1);
        assert_eq!(r["clearance"]["violation_count"], 1);
        assert_eq!(r["clearance"]["min_gap_mm"], 0.05);
        assert_eq!(r["routing"]["total_length_mm"], 10.0);
    }

    #[test]
    fn odd_field_types_read_as_missing() {
        let text = br#"[1, "x", null, {"type": "pcb_board", "width": "10", "height": 4, "outline": 7},
            {"type": "pcb_trace", "route": {"no": 1}, "connectsTo": [1, null]}, {"type": 5}]"#;
        let parse::Top(Some(els)) = serde_json::from_slice(text).unwrap() else { panic!("not an array") };
        assert_eq!(els.len(), 6);
        let r = analyze(&els, 0.1);
        assert_eq!(r["board"]["width_mm"], 0.0);
        assert_eq!(r["board"]["height_mm"], 4.0);
        assert_eq!(r["counts"]["pcb_traces"], 1);
    }

    #[test]
    fn crossing_traces_have_zero_gap() {
        let a = Seg::line(0.0, 0.0, 2.0, 2.0);
        let b = Seg::line(0.0, 2.0, 2.0, 0.0);
        assert_eq!(seg_seg(&a, &b), 0.0);
    }
}
