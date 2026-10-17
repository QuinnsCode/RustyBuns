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
#   rock   a granite boulder: fine rings whose top is roughened by noise, in patches of pale and dark granite and lichen
#   log    a fallen trunk: bark furrowed along its length with moss on it, end grain with rings where it tapers to the ground
#   cliff  a granite buttress that turns to vertical (a rock face): a jittered square grid in patches of granite and lichen; its
#          roughness lives in x, z and the top band of y, so the ridden surface stays where the sim has it
#   bowl   a poured concrete pool: saw-cut panel joints, with its tile band and floor shaded by height in kit.ts
#   hip    a wooden hip: sheets meeting in four creases, each with an orange trim strip, a steel plate round the foot
#
# The landscape pieces (rock, log, hip) are their whole shape, so they are fitted linearly instead (the log keeps its
# end bands, which are exactly its taper): their top is a plain grid (rings on the rock), at every budget fine enough for the drape.
#
# Materials are named for what the page paints; their colours here are the ones it uses.
import math
import os
import sys

import bmesh
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, join, obj, reset, write_glb  # noqa: E402

hexes = {
    "surface": 0xC98A52, "seam": 0x6E4526, "trim": 0xE2572B, "side": 0x9D978D, "frame": 0x6E4526, "plate": 0xA5ACB4,
    "tread": 0xB9B3AA, "nosing": 0xA5ACB4, "riser": 0x9D978D, "cheek": 0x8A847B, "concrete": 0xB9B3AA, "plinth": 0x7A746B,
    "granite": 0xA8A39A, "granite-dark": 0x8E8981, "lichen": 0x9AA06A,
    "bark": 0x5C4433, "moss": 0x66753A, "grain": 0xD8B888, "ring": 0xA9814F,
    "pool": 0xAFA9A0, "joint": 0x77716A,
}
PALETTE.update({k: ((h >> 16) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 0.85, 0) for k, h in hexes.items()})
# Per budget: rows along the ramp (its curve) and columns across (the ground under a draped piece): enough at every budget
# that the drawn top stays within a hand of the ridden one, then ribs per side, bevel segments, sheets along the top.
BUDGETS = {
    "hi": {"rows": 64, "cols": 10, "ribs": 9, "segs": 3, "sheets": 8, "rock": 20, "log": (32, 28, 8), "hip": 24, "cliff": 72, "pool": 80, "joints": 10},
    "mid": {"rows": 48, "cols": 8, "ribs": 5, "segs": 2, "sheets": 6, "rock": 14, "log": (24, 20, 5), "hip": 16, "cliff": 48, "pool": 60, "joints": 8},
    "low": {"rows": 32, "cols": 6, "ribs": 0, "segs": 1, "sheets": 4, "rock": 9, "log": (16, 14, 3), "hip": 12, "cliff": 30, "pool": 40, "joints": 5},
}
BAND = 0.4  # where the fixed-size edge band starts, in x and z; y's starts at 0.9


def spread(n, a=-BAND, b=BAND):
    return [a + (b - a) * i / n for i in range(n + 1)]


def slab(xs, zs, ts, creased=False):
    """
    A box over the unit footprint, split at the given x, z (top) and y (sides), open underneath where it meets the ground.
    `creased` cuts each top quad along the diagonal that runs from the middle to its quadrant's corner, as a hip's creases do.
    """
    bm = bmesh.new()
    top = [[bm.verts.new((x, 1, z)) for x in xs] for z in zs]
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            a, b, c, d = top[j][i], top[j + 1][i], top[j + 1][i + 1], top[j][i + 1]
            if not creased:
                bm.faces.new((a, b, c, d))
            elif (xs[i] + xs[i + 1]) * (zs[j] + zs[j + 1]) > 0:
                bm.faces.new((a, b, c)), bm.faces.new((a, c, d))
            else:
                bm.faces.new((a, b, d)), bm.faces.new((b, c, d))
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


def grid(n, a=-0.5, b=0.5):
    return [a + (b - a) * i / n for i in range(n + 1)]


def rock(b):
    # Rings round the middle, closer together towards the foot where a dome steepens; the last ring is the
    # footprint's square, so its corners still reach the pad. A wall drops from that ring to the ground.
    rings, segs = b["rock"], 4 * b["rock"]
    bm = bmesh.new()
    angles = [2 * math.pi * k / segs for k in range(segs)]

    def rough(x, z):  # the fit keeps this within the top band, so it fades out towards the foot
        return 0.05 * max(-1, min(1, 1.6 * noise.noise(Vector((x * 5, z * 5, 0.3))) + 0.5 * noise.noise(Vector((x * 17, z * 17, 4.1)))))

    def ring(r, t=None):
        out = []
        for a in angles:
            x, z = r * math.cos(a), r * math.sin(a)
            if r > 0.55:  # out to the square's edge
                x, z = (0.5 * x / max(abs(x), abs(z)), 0.5 * z / max(abs(x), abs(z)))
            out.append(bm.verts.new((x, 1 + rough(x, z) if t is None else t, z)))
        return out

    middle = bm.verts.new((0, 1 + rough(0, 0), 0))
    # The last ring a hair past the dome's foot, so what lies beyond it reads as bare ground and is dropped on a dome.
    rows = [ring(0.502 * math.sin(math.pi / 2 * k / rings)) for k in range(1, rings + 1)] + [ring(0.6), ring(0.6, 0)]
    for k in range(segs):
        bm.faces.new((middle, rows[0][(k + 1) % segs], rows[0][k]))
        for lo, hi in zip(rows, rows[1:]):
            bm.faces.new((lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mats = ["granite", "granite-dark", "lichen"]

    def pick(c, n):  # lichen in a few soft patches, the granite mottled
        if noise.noise(Vector((c.x * 3, c.z * 3, 9.7))) + 0.3 * noise.noise(Vector((c.x * 20, c.z * 20, 1.1))) > 0.4:
            return "lichen"
        return "granite-dark" if noise.noise(Vector((c.x * 14, c.z * 14, 2.2))) + 0.4 * noise.noise(Vector((c.x * 40, c.z * 40, 7.7))) > 0.25 else "granite"

    return [paint(obj("rock", bm, mats), mats, pick)]


def log(b):
    cols, rows, end = b["log"]
    zs = sorted({*grid(end, -0.5, -BAND), *grid(rows, -BAND, BAND), *grid(end, BAND, 0.5)})
    bm = slab(grid(cols), zs, [0, 1])
    ridges = cols // 4  # furrows the columns can draw at every budget
    for v in bm.verts:  # bark furrowed along the trunk, wandering a little; the cut ends stay smooth
        if v.co.y == 1 and abs(v.co.z) <= BAND:
            u = (v.co.x + 0.5 + 0.012 * noise.noise(Vector((v.co.z * 3, 0, 1.7)))) * ridges
            v.co.y -= 0.06 * (1 - abs(math.sin(math.pi * u))) ** 2
    mats = ["bark", "moss", "grain", "ring"]

    def pick(c, n):
        if abs(c.z) > BAND and n.y > 0:
            # How far from the trunk's axis this point of the sloping cut is: rings round it, bark at the rim.
            s = (0.5 - abs(c.z)) / (0.5 - BAND)
            rho = math.sqrt(4 * c.x * c.x + (1 - 4 * c.x * c.x) * s * s)
            return "bark" if rho > 0.9 else "ring" if int(rho * 9) % 2 else "grain"
        return "moss" if noise.noise(Vector((c.x * 6, c.z * 3, 5.3))) > 0.35 else "bark"

    return [paint(obj("log", bm, mats), mats, pick)]


HIP_PLATE = 0.48
HIP_TRIM = 0.008  # half a crease strip's width


def hip(b):
    # The same lines across and along, so every crease (|x| = |z|) runs through vertices and along cut diagonals.
    joints = grid(b["sheets"] // 2, 0, 0.5)[1:-1]  # sheet joints at even heights up each face
    half = {*grid(b["hip"] // 2, 0, 0.5), *(j + d for j in joints for d in (-SEAM, SEAM)), SEAM, HIP_PLATE}
    cuts = sorted({*half, *(-c for c in half)})
    bm = slab(cuts, cuts, [0, 1], creased=True)
    mats = ["surface", "seam", "plate", "side", "trim"]

    def pick(c, n):
        if n.y <= 0.1:
            return "side"
        up, across = (abs(c.z), c.x) if abs(c.z) > abs(c.x) else (abs(c.x), c.z)  # the face it is on: how far out, how far along
        if up > HIP_PLATE:
            return "plate"
        return "seam" if abs(across) < SEAM or any(abs(0.5 - up - j) < SEAM for j in joints) else "surface"

    parts = [paint(obj("hip", bm, mats), mats, pick)]
    # A trim strip down each crease, from the foot to the top: its sides lie in the faces, its middle a little proud.
    steps = sorted(c for c in half if c > 2 * HIP_TRIM)
    for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        strip = bmesh.new()
        px, pz = sx * HIP_TRIM, -sz * HIP_TRIM
        rows = [[strip.verts.new((sx * u + k * px, 1.03 if k == 0 else 1, sz * u + k * pz)) for k in (-1, 0, 1)] for u in steps]
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(2):
                f = strip.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
                f.normal_update()
                if f.normal.y < 0:
                    f.normal_flip()
        parts.append(paint(obj("crease", strip, mats), mats, lambda c, n: "trim"))
    return parts


def vnoise(x, z, seed, cell):
    """Value noise in 0..1: random at each corner of a grid `cell` wide, smoothly blended between."""
    def at(i, j):
        return (math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453) % 1.0
    u, v = x / cell, z / cell
    i, j = math.floor(u), math.floor(v)
    fu, fv = u - i, v - j
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv


def cliff(b):
    n = b["cliff"]
    bm = slab(grid(n), grid(n), [0, 1])
    for v in bm.verts:
        if v.co.y < 1 and not (abs(v.co.x) == 0.5 or abs(v.co.z) == 0.5):
            continue
        inner = abs(v.co.x) < 0.5 and abs(v.co.z) < 0.5
        # The top band of y is a fixed size in metres, so this is a hand's depth of facet whatever the face's size; in x and z
        # the jitter is a fraction of a cell (it reads as strata and cracks once the face has turned to vertical).
        if v.co.y == 1:
            v.co.y = 0.93 + 0.14 * (0.6 * vnoise(v.co.x, v.co.z, 1, 0.09) + 0.4 * vnoise(v.co.x, v.co.z, 2, 0.03))
        if inner:
            v.co.x += (vnoise(v.co.x, v.co.z, 3, 2.3 / n) - 0.5) * 0.9 / n
            v.co.z += (vnoise(v.co.x, v.co.z, 4, 2.3 / n) - 0.5) * 0.9 / n
    mats = ["granite", "granite-dark", "lichen"]

    def pick(c, nrm):
        if nrm.y < 0.5:
            return "granite-dark"
        k, l = vnoise(c.x, c.z, 5, 0.3), vnoise(c.x, c.z, 6, 0.14)
        return "lichen" if k > 0.8 and l > 0.5 else "granite-dark" if k < 0.3 else "granite"

    return [paint(obj("cliff", bm, mats), mats, pick)]


def bowl(b):
    n, j = b["pool"], b["joints"]
    cuts = [-0.5 + (i + 1) / (j + 1) for i in range(j)]
    w = 0.0006  # a saw cut, thin even on a 90 m pool
    xs = sorted({*grid(n), *(c + d for c in cuts for d in (-w, w))})
    bm = slab(xs, xs, [0, 0.9, 1])
    mats = ["pool", "joint", "plinth"]

    def pick(c, nrm):
        if nrm.y < 0.5:
            return "plinth"
        near = lambda v: any(abs(v - k) <= w * 1.01 for k in cuts)
        return "joint" if near(c.x) or near(c.z) else "pool"

    return [paint(obj("bowl", bm, mats), mats, pick)]


def main():
    for budget, b in BUDGETS.items():
        for name, build in (("ramp", ramp), ("step", step), ("block", block), ("rock", rock), ("log", log), ("hip", hip), ("cliff", cliff), ("bowl", bowl)):
            reset()
            write_glb(join(build(b), name, smooth=30), os.path.join(OUT, f"kit-{name}-{budget}.glb"))


main()
