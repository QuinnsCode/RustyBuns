# The rocket roadster's body, modelled in Blender and written out at a few polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/roadster.py -- [--render out.png]
#
# It follows the October 2026 reveal and the shared roadster (packages/models/src/roadster.ts): a faceted paper
# wedge on a dark sill, a gold-tinted visor canopy, a slit for hidden headlights across the nose, a light bar the
# width of the tail over an ink diffuser, intakes behind the doors, and four wheels with thin orange rings. It
# keeps the shared footprint (about 4.7 m by 2.1 m, wheels of 0.42 m radius at x = +-1.0, z = 1.4 and -1.45),
# so the page drops it over that one and keeps the shared nozzle bells and hinged plate, which the plumes and the
# swap animate. Nose toward +z, in the game's frame. Budgets differ in how round the wheels are; the body is flat.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, args, join, obj, render, reset, write_glb  # noqa: E402

BUDGETS = {"hi": 40, "mid": 20, "low": 10}  # segments round a wheel
PALETTE.update({
    "paint": (0.957, 0.961, 0.949, 0.25, 0.1), "ink": (0.106, 0.11, 0.122, 0.8, 0), "glass": (0.17, 0.13, 0.063, 0.12, 0.8),
    "tyre": (0.067, 0.067, 0.067, 0.9, 0), "rim": (0.725, 0.737, 0.761, 0.3, 0.8), "ring": (0.93, 0.38, 0.1, 0.4, 0),
    "headlight": (1.0, 1.0, 1.0, 0.2, 0, 4.0), "taillight": (1.0, 0.165, 0.165, 0.2, 0, 4.0),
})
WHEELS = [(-1.0, 1.4), (1.0, 1.4), (-1.0, -1.45), (1.0, -1.45)]
WHEEL_R = 0.42

# Side profiles, (along, up) pairs, nose first.
BODY = [(2.35, 0.34), (2.4, 0.52), (0.95, 0.84), (-1.45, 0.96), (-2.25, 1.0), (-2.25, 0.6), (-2.05, 0.34)]
VISOR = [(0.95, 0.84), (0.05, 1.24), (-0.55, 1.28), (-1.7, 0.99), (-1.45, 0.96)]


def solid(name, mat, profile, wide, taper=0.0, base=0.0):
    """A profile pushed out `wide` across the car; points above `base` draw in by `taper` per metre of height,
    which gives the flanks their slant."""
    bm = bmesh.new()
    rows = []
    for z, y in profile:
        w = wide / 2 - taper * max(0.0, y - base)
        rows.append((bm.verts.new((-w, y, z)), bm.verts.new((w, y, z))))
    n = len(rows)
    for k in range(n):
        (l0, r0), (l1, r1) = rows[k], rows[(k + 1) % n]
        bm.faces.new((l0, l1, r1, r0))
    bm.faces.new([r[0] for r in rows][::-1])
    bm.faces.new([r[1] for r in rows])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [mat])


def box(name, mat, size, at):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(at) @ Matrix.Diagonal((*size, 1)))
    return obj(name, bm, [mat])


def wheel(x, z, around):
    """A tyre, a silver rim with a spoke so it shows turning, and a thin orange ring on the outer face."""
    side = 1 if x > 0 else -1
    along_x = Matrix.Rotation(math.pi / 2, 4, "Y")
    at = lambda dx=0: Matrix.Translation((x + dx, WHEEL_R, z)) @ along_x  # noqa: E731

    def disc(name, mat, r1, r2, depth, dx=0, caps=True):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, segments=around, radius1=r1, radius2=r2, depth=depth, matrix=at(dx))
        return obj(name, bm, [mat])

    parts = [disc("tyre", "tyre", WHEEL_R, WHEEL_R, 0.34), disc("rim", "rim", 0.28, 0.28, 0.36)]
    parts.append(box("spoke", "ink", (0.37, 0.06, 0.6), (x, WHEEL_R, z)))
    parts.append(disc("ring", "ring", 0.34, 0.34, 0.012, side * 0.172))  # standing just proud of the tyre's face
    return parts


def build(around):
    car = [
        box("sill", "ink", (1.9, 0.24, 4.2), (0, 0.36, 0)),
        solid("body", "paint", BODY, 2.1, taper=0.2, base=0.6),
        solid("visor", "glass", VISOR, 1.6, taper=0.25, base=0.9),
        box("headlight", "headlight", (1.7, 0.04, 0.04), (0, 0.56, 2.39)),  # hidden in a slit across the nose
        box("taillight", "taillight", (2.12, 0.06, 0.04), (0, 0.94, -2.26)),  # the tail bar, the car's full width
        box("diffuser", "ink", (2.0, 0.26, 0.26), (0, 0.47, -2.12)),
    ]
    car += [box("intake", "ink", (0.02, 0.22, 0.55), (x, 0.66, -1.0)) for x in (-1.06, 1.06)]
    for x, z in WHEELS:
        car += wheel(x, z, around)
    return car


def main():
    reset()
    parts = build(BUDGETS["hi"])
    model = join(parts, "roadster", smooth=35)
    write_glb(model, os.path.join(OUT, "roadster-hi.glb"))
    for budget in ("mid", "low"):
        reset()
        write_glb(join(build(BUDGETS[budget]), "roadster", smooth=35), os.path.join(OUT, f"roadster-{budget}.glb"))
    if "--render" in args():
        reset()
        join(build(BUDGETS["hi"]), "roadster", smooth=35)
        path = os.path.abspath(args()[args().index("--render") + 1])
        render(path, (("", (5.5, -4.5, 2.6)), ("-rear", (-4.0, 5.0, 2.2)), ("-side", (7.5, 0, 1.0)), ("-front", (1.5, -7.0, 1.4))), target=(0, 0, 0.6))


main()
