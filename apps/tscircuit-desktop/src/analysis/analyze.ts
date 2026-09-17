// Board analysis over tscircuit Circuit JSON: the TypeScript twin of
// native/crates/tsci_analysis/src/lib.rs. Same math in the same order, so the
// two agree (tests/parity.test.ts). This file is the fallback when neither the
// native library nor the wasm build is available; it runs anywhere.

export const MAX_VIOLATIONS = 50;
export const DEFAULT_VIA_DIAMETER = 0.6;
export const DEFAULT_TRACE_WIDTH = 0.15;

export interface Analysis {
  board: { width_mm: number; height_mm: number; area_mm2: number; layers: number };
  counts: { components: number; ports: number; nets: number; pads: number; pcb_traces: number; segments: number; vias: number };
  routing: { total_length_mm: number; by_layer_mm: Record<string, number>; min_width_mm: number | null; unrouted_nets: number };
  copper: { trace_mm2: number; pad_mm2: number; via_mm2: number; total_mm2: number; density_pct: number | null };
  longest_nets: { name: string; ports: number; length_mm: number }[];
  clearance: {
    min_clearance_mm: number; pairs_checked: number; min_gap_mm: number | null;
    violation_count: number; violations: { a: string; b: string; gap_mm: number }[];
  };
}

interface Seg { x1: number; y1: number; x2: number; y2: number; hw: number; layer: string; group: number; id: string }
interface Pad { minx: number; maxx: number; miny: number; maxy: number; circle: [number, number, number] | null; layer: string; group: number; id: string }

// ---------- geometry (keep in lockstep with lib.rs) ----------
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const line = (x1: number, y1: number, x2: number, y2: number): Seg => ({ x1, y1, x2, y2, hw: 0, layer: "", group: 0, id: "" });

function pointSeg(px: number, py: number, s: Seg): number {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return len(px - s.x1, py - s.y1);
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / l2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return len(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

function crosses(a: Seg, b: Seg): boolean {
  const d1 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segSeg(a: Seg, b: Seg): number {
  if (crosses(a, b)) return 0;
  let d = pointSeg(a.x1, a.y1, b);
  d = Math.min(d, pointSeg(a.x2, a.y2, b));
  d = Math.min(d, pointSeg(b.x1, b.y1, a));
  return Math.min(d, pointSeg(b.x2, b.y2, a));
}

function pointRect(px: number, py: number, r: Pad): number {
  const dx = Math.max(Math.max(r.minx - px, 0), px - r.maxx);
  const dy = Math.max(Math.max(r.miny - py, 0), py - r.maxy);
  return len(dx, dy);
}

function segRect(s: Seg, r: Pad): number {
  const a = pointRect(s.x1, s.y1, r), b = pointRect(s.x2, s.y2, r);
  if (a === 0 || b === 0) return 0;
  const edges = [
    line(r.minx, r.miny, r.maxx, r.miny), line(r.maxx, r.miny, r.maxx, r.maxy),
    line(r.maxx, r.maxy, r.minx, r.maxy), line(r.minx, r.maxy, r.minx, r.miny),
  ];
  let d = Math.min(a, b);
  for (const e of edges) {
    if (crosses(s, e)) return 0;
    d = Math.min(d, pointSeg(e.x1, e.y1, s));
  }
  return d;
}

/** floor(x+0.5), matching lib.rs (Math.round and Rust round disagree on negative halves). */
const r6 = (x: number) => Math.floor(x * 1e6 + 0.5) / 1e6;
const str = (e: any, k: string): string => (typeof e?.[k] === "string" ? e[k] : "");
const num = (e: any, k: string): number | undefined => (typeof e?.[k] === "number" ? e[k] : undefined);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function analyze(elements: any[], minClearance: number): Analysis {
  const byType = (t: string) => elements.filter((e) => str(e, "type") === t);

  // board
  const board = byType("pcb_board")[0];
  const bw = board ? num(board, "width") ?? 0 : 0;
  const bh = board ? num(board, "height") ?? 0 : 0;
  const layers = (board && num(board, "num_layers")) ?? 2;
  let area = bw * bh;
  const outline = board?.outline;
  if (Array.isArray(outline) && outline.length >= 3) {
    let a = 0;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i], q = outline[(i + 1) % outline.length];
      a += (num(p, "x") ?? 0) * (num(q, "y") ?? 0) - (num(q, "x") ?? 0) * (num(p, "y") ?? 0);
    }
    area = Math.abs(a / 2);
  }

  // connectivity: ports first, then nets, in element order
  const ports = byType("source_port");
  const nets = byType("source_net");
  const node = new Map<string, number>();
  ports.forEach((p, i) => node.set(`port:${str(p, "source_port_id")}`, i));
  nets.forEach((n, i) => node.set(`net:${str(n, "source_net_id")}`, ports.length + i));
  const parent = Array.from({ length: ports.length + nets.length }, (_, i) => i);
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const traceFirstNode = new Map<string, number>();
  for (const t of byType("source_trace")) {
    const ids: number[] = [];
    for (const [k, prefix] of [["connected_source_port_ids", "port:"], ["connected_source_net_ids", "net:"]] as const) {
      for (const id of Array.isArray(t[k]) ? t[k] : []) {
        if (typeof id !== "string") continue;
        const n = node.get(prefix + id);
        if (n !== undefined) ids.push(n);
      }
    }
    if (ids.length) {
      for (const n of ids.slice(1)) union(ids[0]!, n);
      traceFirstNode.set(str(t, "source_trace_id"), ids[0]!);
    }
  }
  const compName = new Map(byType("source_component").map((c) => [str(c, "source_component_id"), str(c, "name")]));
  const groupPorts = new Map<number, number>();
  const groupName = new Map<number, string>();
  nets.forEach((n, i) => { const g = find(ports.length + i); if (!groupName.has(g)) groupName.set(g, str(n, "name")); });
  ports.forEach((p, i) => {
    const g = find(i);
    groupPorts.set(g, (groupPorts.get(g) ?? 0) + 1);
    if (!groupName.has(g)) groupName.set(g, `${compName.get(str(p, "source_component_id")) ?? "?"}.${str(p, "name")}`);
  });
  const pcbToSource = new Map(byType("pcb_port").map((p) => [str(p, "pcb_port_id"), str(p, "source_port_id")]));
  const groupOfPcbPort = (id: string): number | undefined => {
    const sp = pcbToSource.get(id);
    if (sp === undefined) return undefined;
    const n = node.get(`port:${sp}`);
    return n === undefined ? undefined : find(n);
  };

  // traces -> segments
  const segs: Seg[] = [];
  let totalLen = 0, traceArea = 0, minWidth = Infinity, vias = 0, viaArea = 0, pcbTraces = 0;
  const layerLen = new Map<string, number>();
  const groupLen = new Map<number, number>();
  byType("pcb_trace").forEach((t, ti) => {
    pcbTraces++;
    const route: any[] = Array.isArray(t.route) ? t.route : [];
    const portIds: string[] = (Array.isArray(t.connectsTo) ? t.connectsTo : []).filter((x: unknown) => typeof x === "string");
    for (const p of route) for (const k of ["start_pcb_port_id", "end_pcb_port_id"]) if (typeof p?.[k] === "string") portIds.push(p[k]);
    let group: number | undefined;
    for (const id of portIds) { const g = groupOfPcbPort(id); if (g !== undefined) { group = g; break; } }
    if (group === undefined) {
      const cn = str(t, "connection_name");
      const n = node.get(`net:${cn}`) ?? traceFirstNode.get(cn);
      group = n === undefined ? undefined : find(n);
    }
    const g = group ?? -ti - 1;
    const id = str(t, "pcb_trace_id");
    for (const p of route) {
      if (str(p, "route_type") === "via") {
        vias++;
        const d = DEFAULT_VIA_DIAMETER;
        viaArea += Math.PI * (d / 2) * (d / 2);
      }
    }
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i], b = route[i + 1];
      if (str(a, "route_type") !== "wire" || str(b, "route_type") !== "wire") continue;
      if (str(a, "layer") !== str(b, "layer")) continue;
      const x1 = num(a, "x"), y1 = num(a, "y"), x2 = num(b, "x"), y2 = num(b, "y");
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
      const width = num(a, "width") ?? DEFAULT_TRACE_WIDTH;
      const l = len(x2 - x1, y2 - y1);
      totalLen += l;
      traceArea += l * width;
      if (width < minWidth) minWidth = width;
      const layer = str(a, "layer");
      layerLen.set(layer, (layerLen.get(layer) ?? 0) + l);
      groupLen.set(g, (groupLen.get(g) ?? 0) + l);
      segs.push({ x1, y1, x2, y2, hw: width / 2, layer, group: g, id });
    }
  });
  for (const v of byType("pcb_via")) {
    vias++;
    const d = num(v, "outer_diameter") ?? DEFAULT_VIA_DIAMETER;
    viaArea += Math.PI * (d / 2) * (d / 2);
  }

  // pads
  const pads: Pad[] = [];
  let padArea = 0;
  byType("pcb_smtpad").forEach((p, pi) => {
    const x = num(p, "x") ?? 0, y = num(p, "y") ?? 0;
    const group = groupOfPcbPort(str(p, "pcb_port_id")) ?? -1_000_000 - pi;
    const layer = str(p, "layer"), id = str(p, "pcb_smtpad_id");
    if (str(p, "shape") === "circle") {
      const r = num(p, "radius") ?? 0;
      padArea += Math.PI * r * r;
      pads.push({ minx: x - r, maxx: x + r, miny: y - r, maxy: y + r, circle: [x, y, r], layer, group, id });
    } else {
      const w = num(p, "width"), h = num(p, "height");
      if (w === undefined || h === undefined) return;
      padArea += w * h;
      pads.push({ minx: x - w / 2, maxx: x + w / 2, miny: y - h / 2, maxy: y + h / 2, circle: null, layer, group, id });
    }
  });

  // clearance: every segment vs every later segment and every pad, other nets, same layer
  let checked = 0, minGap = Infinity;
  const viols: { a: string; b: string; gap: number }[] = [];
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]!;
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j]!;
      if (b.layer !== a.layer || b.group === a.group) continue;
      checked++;
      const gap = segSeg(a, b) - a.hw - b.hw;
      if (gap < minGap) minGap = gap;
      if (gap < minClearance) viols.push({ a: a.id, b: b.id, gap });
    }
    for (const p of pads) {
      if (p.layer !== a.layer || p.group === a.group) continue;
      checked++;
      const gap = p.circle ? pointSeg(p.circle[0], p.circle[1], a) - p.circle[2] - a.hw : segRect(a, p) - a.hw;
      if (gap < minGap) minGap = gap;
      if (gap < minClearance) viols.push({ a: a.id, b: p.id, gap });
    }
  }
  viols.sort((x, y) => x.gap - y.gap || cmp(x.a, y.a) || cmp(x.b, y.b));

  // nets: every group with 2+ ports
  const netRows = [...groupPorts].filter(([, c]) => c >= 2).map(([g, c]) => ({ name: groupName.get(g)!, ports: c, length: groupLen.get(g) ?? 0 }));
  const unrouted = netRows.filter((r) => r.length === 0).length;
  netRows.sort((x, y) => y.length - x.length || cmp(x.name, y.name));

  const copper = traceArea + padArea + viaArea;
  return {
    board: { width_mm: r6(bw), height_mm: r6(bh), area_mm2: r6(area), layers },
    counts: {
      components: byType("source_component").length, ports: ports.length, nets: netRows.length,
      pads: pads.length, pcb_traces: pcbTraces, segments: segs.length, vias,
    },
    routing: {
      total_length_mm: r6(totalLen),
      by_layer_mm: Object.fromEntries([...layerLen].map(([k, v]) => [k, r6(v)])),
      min_width_mm: Number.isFinite(minWidth) ? r6(minWidth) : null,
      unrouted_nets: unrouted,
    },
    copper: {
      trace_mm2: r6(traceArea), pad_mm2: r6(padArea), via_mm2: r6(viaArea), total_mm2: r6(copper),
      density_pct: area > 0 ? r6((copper / area) * 100) : null,
    },
    longest_nets: netRows.slice(0, 10).map((r) => ({ name: r.name, ports: r.ports, length_mm: r6(r.length) })),
    clearance: {
      min_clearance_mm: minClearance, pairs_checked: checked,
      min_gap_mm: Number.isFinite(minGap) ? r6(minGap) : null,
      violation_count: viols.length,
      violations: viols.slice(0, MAX_VIOLATIONS).map((v) => ({ a: v.a, b: v.b, gap_mm: r6(v.gap) })),
    },
  };
}
