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

