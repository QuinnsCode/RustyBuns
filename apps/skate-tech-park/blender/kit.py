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
#   rock   a granite boulder or a buttress that turns to vertical: a faceted, jittered grid in patches of granite, dark
#          streak and lichen. Its roughness lives in x, z and the top band of y, so the ridden surface stays where the sim has it
#   bowl   a poured concrete pool: saw-cut panel joints, with its tile band and floor shaded by height in kit.ts
#   log    a fallen trunk: bark furrows along its length and pale end grain at both ends
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
    "granite": 0xA8A29A, "streak": 0x7C7771, "lichen": 0x8A9468, "warm": 0xB59F86, "base": 0x6F6A64,
    "pool": 0xAFA9A0, "joint": 0x77716A, "bark": 0x8A6244, "furrow": 0x543A28, "grain": 0xD9C29A, "moss": 0x6F7F4B,
}
PALETTE.update({k: ((h >> 16) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 0.85, 0) for k, h in hexes.items()})
# Per budget: rows along the ramp (its curve) and columns across (the ground under a draped piece): enough at every budget
# that the drawn top stays within a hand of the ridden one, then ribs per side, bevel segments, sheets along the top.
BUDGETS = {
    "hi": {"rows": 64, "cols": 10, "ribs": 9, "segs": 3, "sheets": 8},
    "mid": {"rows": 48, "cols": 8, "ribs": 5, "segs": 2, "sheets": 6},
    "low": {"rows": 32, "cols": 6, "ribs": 0, "segs": 1, "sheets": 4},
}
# Grid cells across and along a rock, a pool or a log. A rock turns to vertical, a pool wall curves and a log is round, so
# these keep the shape at every budget and only the jitter and the joints thin out.
BIG = {
    "hi": {"rock": 72, "pool": 80, "joints": 10, "log": (20, 80)},
    "mid": {"rock": 48, "pool": 60, "joints": 8, "log": (14, 56)},
    "low": {"rock": 30, "pool": 40, "joints": 5, "log": (10, 36)},
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


def noise(x, z, seed, cell):
    """Value noise in 0..1: random at each corner of a grid `cell` wide, smoothly blended between."""
    def at(i, j):
        return (math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453) % 1.0
    u, v = x / cell, z / cell
    i, j = math.floor(u), math.floor(v)
    fu, fv = u - i, v - j
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv


def grid(n, a=-0.5, b=0.5):
    return [a + (b - a) * i / n for i in range(n + 1)]


def rock(b):
    n = b["rock"]
    xs = zs = grid(n)
    bm = slab(xs, zs, [0, 1])
    for v in bm.verts:
        if v.co.y < 1 and not (abs(v.co.x) == 0.5 or abs(v.co.z) == 0.5):
            continue
        inner = abs(v.co.x) < 0.5 and abs(v.co.z) < 0.5
        # The top band of y is a fixed size in metres, so this is a hand's depth of facet whatever the rock's size.
        # In x and z the jitter is a fraction of a cell (it reads as strata and cracks on a wall that has turned to vertical).
        if v.co.y == 1:
            v.co.y = 0.93 + 0.14 * (0.6 * noise(v.co.x, v.co.z, 1, 0.09) + 0.4 * noise(v.co.x, v.co.z, 2, 0.03))
        if inner:
            v.co.x += (noise(v.co.x, v.co.z, 3, 1.0 / n * 2.3) - 0.5) * 0.9 / n
            v.co.z += (noise(v.co.x, v.co.z, 4, 1.0 / n * 2.3) - 0.5) * 0.9 / n
    mats = ["granite", "streak", "lichen", "warm", "base"]

    def pick(c, nrm):
        if nrm.y < 0.5:  # the cut sides: banded granite, so a rock seen from behind is not one flat colour
            k = noise(c.x + c.z, c.y * 3, 10, 0.25)
            return "streak" if k < 0.4 else "base" if k < 0.7 else "granite"
        k, l = noise(c.x, c.z, 5, 0.3), noise(c.x, c.z, 6, 0.14)
        return "lichen" if k > 0.8 and l > 0.5 else "streak" if k < 0.28 else "warm" if l > 0.75 else "granite"

    return [paint(obj("rock", bm, mats), mats, pick)]


def bowl(b):
    n, j = b["pool"], b["joints"]
    cuts = [-0.5 + (i + 1) / (j + 1) for i in range(j)]
    zcuts = [-0.5 + (i + 1) / (j + 1) for i in range(j)]
    w = 0.0006  # a saw cut, thin even on a 90 m pool
    xs = sorted({*grid(n), *(c + d for c in cuts for d in (-w, w))})
    zs = sorted({*grid(n), *(c + d for c in zcuts for d in (-w, w))})
    bm = slab(xs, zs, [0, 0.9, 1])
    mats = ["pool", "joint", "plinth"]

    def pick(c, nrm):
        if nrm.y < 0.5:
            return "plinth"
        near = lambda v, cs: any(abs(v - k) <= w * 1.01 for k in cs)
        return "joint" if near(c.x, cuts) or near(c.z, zcuts) else "pool"

    return [paint(obj("bowl", bm, mats), mats, pick)]


def log(b):
    nx, nz = b["log"]
    xs, zs = grid(nx), grid(nz)
    bm = slab(xs, zs, [0, 1])
    for v in bm.verts:
        if v.co.y == 1:  # furrows run along z: a different one for each strip across the trunk
            v.co.y = 0.97 + 0.06 * (0.7 * noise(v.co.x, v.co.z * 0.05, 7, 0.07) + 0.3 * noise(v.co.x, v.co.z, 8, 0.35))
    mats = ["bark", "furrow", "grain", "moss"]

    def pick(c, nrm):
        if nrm.y < 0.5:
            return "grain" if abs(nrm.z) > 0.5 else "bark"
        if abs(c.z) > 0.46:
            return "grain"
        k = noise(c.x, c.z * 0.05, 7, 0.07)
        return "furrow" if k < 0.28 else "moss" if noise(c.x, c.z, 9, 0.2) > 0.82 else "bark"

    return [paint(obj("log", bm, mats), mats, pick)]


def main():
    for budget, b in BUDGETS.items():
        for name, build in (("ramp", ramp), ("step", step), ("block", block), ("rock", rock), ("bowl", bowl), ("log", log)):
            reset()
            write_glb(join(build({**b, **{k: v for k, v in BIG[budget].items()}}), name, smooth=30), os.path.join(OUT, f"kit-{name}-{budget}.glb"))


main()
