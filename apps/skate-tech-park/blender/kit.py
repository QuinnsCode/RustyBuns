# The skate kit's modules, modelled in Blender and written out at three polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/kit.py
#
# A piece's riding surface is its own height function (src/levels/pieces.ts), draped over real ground, so
# no rigid model could match it. Each module is modelled in a unit box instead and src/render/kit.ts fits it
# to a piece: x and z run -0.5 to 0.5 across and along the piece, y runs 0 (the pad) to 1 (the riding
# surface at that point). The outer tenth of x and z, and the top tenth of y, keep a fixed size in metres
# when fitted, so a bevel, a side frame or a steel nosing is the same on a 3 m kicker and a 30 m tabletop.
# Anything past +-0.5 in x stands out from the side by the same rule.
#
#   ramp   a wooden ramp: riding sheets with dark joints, rounded trim along the sides, ply side panels on a frame of ribs,
#          a steel plate where it meets the ground
#   step   one concrete stair: tread, a steel nosing over a recessed riser, cheek walls either side
#   block  a concrete box or ledge: chamfered top, a darker plinth
#
# Materials are named for what the page paints; their colours here are the ones it uses.
import math
import os
import sys

import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, join, obj, reset, write_glb  # noqa: E402

hexes = {
    "surface": 0xC98A52, "seam": 0x6E4526, "trim": 0xE2572B, "side": 0x9D978D, "frame": 0x6E4526, "plate": 0xA5ACB4,
    "tread": 0xB9B3AA, "nosing": 0xA5ACB4, "riser": 0x9D978D, "cheek": 0x8A847B, "concrete": 0xB9B3AA, "plinth": 0x7A746B,
}
PALETTE.update({k: ((h >> 16) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 0.85, 0) for k, h in hexes.items()})
# Per budget: rows along the ramp (its curve) and columns across (the ground under a draped piece): enough at every budget
# that the drawn top stays within a hand of the ridden one, then ribs per side, bevel segments, sheets along the top.
BUDGETS = {
    "hi": {"rows": 64, "cols": 10, "ribs": 9, "segs": 3, "sheets": 8},
    "mid": {"rows": 48, "cols": 8, "ribs": 5, "segs": 2, "sheets": 6},
    "low": {"rows": 32, "cols": 6, "ribs": 0, "segs": 1, "sheets": 4},
}
BAND = 0.4  # where the fixed-size edge band starts, in x and z; y's starts at 0.9


def spread(n, a=-BAND, b=BAND):
    return [a + (b - a) * i / n for i in range(n + 1)]


def slab(xs, zs, ts):
    """A box over the unit footprint, split at the given x, z (top) and y (sides), open underneath where it meets the ground."""
    bm = bmesh.new()
    top = [[bm.verts.new((x, 1, z)) for x in xs] for z in zs]
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            bm.faces.new((top[j][i], top[j + 1][i], top[j + 1][i + 1], top[j][i + 1]))
    # The rim, walked round once; each wall is a strip from the bottom up through `ts`.
    rim = [(x, zs[0]) for x in xs] + [(xs[-1], z) for z in zs[1:]] + [(x, zs[-1]) for x in reversed(xs[:-1])] + [(xs[0], z) for z in reversed(zs[1:-1])]
    ring = lambda t: [bm.verts.new((x, t, z)) for x, z in rim]
    rows = [ring(t) for t in ts]
    for lo, hi in zip(rows, rows[1:]):
        for k in range(len(rim)):
            a, b = k, (k + 1) % len(rim)
            bm.faces.new((lo[a], hi[a], hi[b], lo[b]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return bm


def bevel(bm, pick, offset, segs):
    edges = [e for e in bm.edges if pick(*(v.co for v in e.verts))]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)


def paint(o, mats, pick):
    """Set each face's material by `pick(centre, normal)` (a name from `mats`)."""
    for f in o.data.polygons:
        f.material_index = mats.index(pick(f.center, f.normal))
    return o


SEAM = 0.004  # half a sheet joint's width


def ramp(b):
    # Sheets: joints across the ramp and one down the middle, each a thin dark strip of the top.
    joints = spread(b["sheets"])[1:-1]
    xs = sorted({-0.5, -0.47, *spread(b["cols"], -0.45, 0.45), -SEAM, SEAM, 0.47, 0.5})
    zs = sorted({-0.5, *spread(b["rows"]), *(z + d for z in joints for d in (-SEAM, SEAM)), 0.5})
    bm = slab(xs, zs, [0, 0.9, 1])
    bevel(bm, lambda a, c: abs(a.x) == 0.5 and abs(c.x) == 0.5 and a.y == 1 and c.y == 1, 0.04, b["segs"])  # the top's long edges
    mats = ["surface", "trim", "side", "frame", "plate", "seam"]

    def pick(c, n):
        if n.y > 0.5:
            if abs(c.z) > BAND:
                return "plate"
            if abs(c.x) > 0.45:
                return "trim"
            return "seam" if abs(c.x) < SEAM or any(abs(c.z - z) < SEAM for z in joints) else "surface"
        return "trim" if abs(n.x) > 0.5 and c.y > 0.9 else "side"

    parts = [paint(obj("ramp", bm, mats), mats, pick)]
    for k in range(b["ribs"]):  # the frame standing proud of each side panel
        z = -BAND + 2 * BAND * k / max(1, b["ribs"] - 1)
        for side in (-1, 1):
            rib = slab([0.5, 0.53] if side > 0 else [-0.53, -0.5], [z - 0.012, z + 0.012], [0, 0.88])
            for v in rib.verts:
                v.co.y *= 0.88  # stops under the trim
            parts.append(paint(obj("rib", rib, mats), mats, lambda c, n: "frame"))
    return parts


def step(b):
    xs = [-0.5, -0.45] + spread(b["cols"], -0.4, 0.4) + [0.45, 0.5]
    bm = slab(xs, [-0.5, -0.42, 0.5], [0, 0.9, 1])
    for v in bm.verts:  # the riser sits back under the nosing
        if v.co.z == -0.5 and v.co.y < 0.9:
            v.co.z = -0.47
    bevel(bm, lambda a, c: a.z == -0.5 and c.z == -0.5 and a.y == 1 and c.y == 1, 0.03, b["segs"])
    mats = ["tread", "nosing", "riser", "cheek"]

    def pick(c, n):
        if n.y > 0.5:
            return "cheek" if abs(c.x) > 0.45 else "nosing" if c.z < -0.42 else "tread"
        if abs(n.x) > 0.5:
            return "cheek"
        return "nosing" if n.z < -0.5 and c.y > 0.9 else "riser"

    return [paint(obj("step", bm, mats), mats, pick)]


def block(b):
    edges = [-0.5, -0.45] + spread(b["cols"], -0.4, 0.4) + [0.45, 0.5]
    bm = slab(edges, edges, [0, 0.15, 0.9, 1])
    bevel(bm, lambda a, c: a.y == 1 and c.y == 1 and ((abs(a.x) == 0.5 and abs(c.x) == 0.5) or (abs(a.z) == 0.5 and abs(c.z) == 0.5)), 0.03, b["segs"])
    mats = ["concrete", "plinth"]
    return [paint(obj("block", bm, mats), mats, lambda c, n: "plinth" if n.y < 0.5 and c.y < 0.15 else "concrete")]


def main():
    for budget, b in BUDGETS.items():
        for name, build in (("ramp", ramp), ("step", step), ("block", block)):
            reset()
            write_glb(join(build(b), name, smooth=30), os.path.join(OUT, f"kit-{name}-{budget}.glb"))


main()
