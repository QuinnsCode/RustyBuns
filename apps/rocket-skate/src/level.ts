// What the sim rides on. A level answers "how high is the floor here" in any direction, lists its
// pieces (the view meshes them by sampling each piece's own height) and its rails, and says where
// to start and where the walls are. The sim imports this type, never a particular level.

export type PieceKind = "ramp" | "box";

export type Piece = {
  kind: PieceKind;
  name: string;
  x: number; z: number; // centre on the floor
  yaw: number; // local +z points along (sin yaw, cos yaw), local +x along (cos yaw, -sin yaw)
  w: number; d: number; // footprint: width across x, depth along z, in local units
  h0: number; h1: number; // top height at local z = -d/2 and +d/2 (a straight rise)
  /** Top height at a point in the piece's own frame (centre origin); 0 outside the footprint. */
  height(localX: number, localZ: number): number;
};

export type RailKind = "rail" | "ledge" | "coping";

export type Rail = {
  kind: RailKind;
  a: { x: number; z: number };
  b: { x: number; z: number };
  y: number; // height of the bar or lip
};

export type Spawn = { name: string; x: number; z: number; yaw: number };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export type Level = {
  name: string;
  /** The floor's height at a world point: the highest piece there, or 0. */
  height(x: number, z: number): number;
  pieces: Piece[];
  rails: Rail[];
  spawns: Spawn[];
  bounds: Bounds;
};

/** A straight-rise piece (kicker, box, ramp): h0 to h1 along local z. */
export function piece(kind: PieceKind, name: string, x: number, z: number, yaw: number, w: number, d: number, h0: number, h1: number): Piece {
  return {
    kind, name, x, z, yaw, w, d, h0, h1,
    height: (lx, lz) => (Math.abs(lx) > w / 2 || Math.abs(lz) > d / 2 ? 0 : h0 + ((lz + d / 2) / d) * (h1 - h0)),
  };
}

/** A world point in a piece's own frame. */
export function toLocal(p: Piece, x: number, z: number): [number, number] {
  const dx = x - p.x, dz = z - p.z, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Builds a Level whose `height` is the highest piece under the point. */
export function makeLevel(l: Omit<Level, "height">): Level {
  return {
    ...l,
    height(x, z) {
      let h = 0;
      for (const p of l.pieces) {
        const [lx, lz] = toLocal(p, x, z);
        if (Math.abs(lx) > p.w / 2 || Math.abs(lz) > p.d / 2) continue;
        h = Math.max(h, p.height(lx, lz));
      }
      return h;
    },
  };
}

/** Where along a rail (0..1) the point projects, and how far off its line it is. */
export function onRail(r: Rail, x: number, z: number) {
  const dx = r.b.x - r.a.x, dz = r.b.z - r.a.z, len = Math.hypot(dx, dz);
  const t = ((x - r.a.x) * dx + (z - r.a.z) * dz) / (len * len);
  return { t, off: Math.hypot(x - (r.a.x + dx * t), z - (r.a.z + dz * t)), dx: dx / len, dz: dz / len, len };
}
