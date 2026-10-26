// A big board with known clearance problems, for tests and the bench.
/** n parallel traces on alternating nets, pitch mm apart, plus a pad row. */
export function syntheticBoard(n: number, pitch: number) {
  const els: any[] = [{ type: "pcb_board", width: 200, height: 200, num_layers: 2 }];
  for (let i = 0; i < n; i++) {
    const y = i * pitch, layer = i % 3 === 0 ? "bottom" : "top";
    els.push({ type: "pcb_trace", pcb_trace_id: `t${i}`, connection_name: `c${i % 7}`, route: [
      { route_type: "wire", x: 0, y, width: 0.15, layer },
      { route_type: "wire", x: 40, y: y + (i % 5) * 0.01, width: 0.15, layer },
      { route_type: "wire", x: 80, y, width: 0.2, layer },
    ] });
  }
  for (let i = 0; i < n / 4; i++) {
    els.push({ type: "pcb_smtpad", pcb_smtpad_id: `p${i}`, shape: i % 2 ? "circle" : "rect", radius: 0.3, width: 0.6, height: 0.4, x: 90, y: i * pitch * 4, layer: "top" });
  }
  return els;
}


/** Seeded random board: n traces in a size x size mm square, on 6 nets, 2 layers, with pads. */
export function randomBoard(seed: number, n: number, size: number) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const els: any[] = [{ type: "pcb_board", width: size, height: size, num_layers: 2 }];
  for (let i = 0; i < n; i++) {
    const layer = rnd() < 0.5 ? "top" : "bottom", width = 0.1 + rnd() * 0.3;
    const route = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ route_type: "wire", x: rnd() * size, y: rnd() * size, width, layer }));
    els.push({ type: "pcb_trace", pcb_trace_id: `t${i}`, connection_name: `c${Math.floor(rnd() * 6)}`, route });
  }
  for (let i = 0; i < n / 4; i++) {
    els.push({ type: "pcb_smtpad", pcb_smtpad_id: `p${i}`, shape: rnd() < 0.5 ? "circle" : "rect", radius: 0.3, width: 0.6, height: 0.4, x: rnd() * size, y: rnd() * size, layer: "top" });
  }
  return els;
}
