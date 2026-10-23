# The rocket roadster's body, modelled in Blender and written out at a few polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/roadster.py -- [--render out.png]
#
# It follows the October 2026 reveal, not the 2017 prototype: sharp and angular in the electric pickup's way,
# flat facets meeting at hard creases, a chine down each flank like a spy plane's, Ano White paint over a dark
# sill, gold-tinted visor glass for the canopy, dual triangular headlights, a plain light bar across the tail
# over a diffuser that holds the four rear nozzles, and the pop-out wing standing up on its struts. Git Recon's
# roadster (packages/models) was the start. It keeps the shared footprint (about 4.7 m by 2.1 m, wheels of
# 0.42 m radius at x = +-1.0, z = 1.4 and -1.45), so the page drops it over that one and keeps the shared nozzle
# bells and hinged plate, which the plumes and the swap animate. Nose toward +z, in the game's frame. Budgets
# differ in how round the wheels and arches are; the body's facets are the same at each.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, apply_all, args, join, modify, obj, render, reset, write_glb  # noqa: E402

BUDGETS = {"hi": 40, "mid": 20, "low": 12}  # segments round a wheel
PALETTE.update({
    "paint": (0.93, 0.94, 0.92, 0.3, 0.15), "ink": (0.106, 0.11, 0.122, 0.8, 0), "glass": (0.5, 0.36, 0.1, 0.12, 0.9),
    "tyre": (0.067, 0.067, 0.067, 0.9, 0), "rim": (0.29, 0.3, 0.32, 0.35, 0.7), "ring": (0.93, 0.38, 0.1, 0.4, 0),
    "headlight": (1.0, 1.0, 1.0, 0.2, 0, 4.0), "taillight": (1.0, 0.165, 0.165, 0.2, 0, 4.0),
})
WHEELS = [(-1.0, 1.4), (1.0, 1.4), (-1.0, -1.45), (1.0, -1.45)]
WHEEL_R = 0.42
ARCH_R = 0.47

# Cross-sections nose to tail: (along, sill y, flank half width, chine y, shoulder half width, shoulder y,
# roof half width, roof y). The roof line runs straight up the windscreen to its peak behind the doors and
# straight down to the tail, one fold, the way the reveal car's does.
STATIONS = [
    (2.42, 0.32, 0.78, 0.48, 0.66, 0.56, 0.36, 0.58),
    (2.3, 0.3, 0.92, 0.52, 0.8, 0.63, 0.44, 0.66),
    (1.85, 0.3, 1.02, 0.66, 0.88, 0.9, 0.5, 0.86),
    (1.4, 0.3, 1.05, 0.7, 0.89, 0.94, 0.5, 0.89),
    (0.85, 0.3, 1.06, 0.72, 0.87, 0.93, 0.5, 0.92),
    (-0.25, 0.3, 1.06, 0.74, 0.8, 0.93, 0.42, 1.24),
    (-1.45, 0.3, 1.06, 0.76, 0.88, 0.96, 0.5, 1.05),
    (-2.15, 0.3, 1.05, 0.78, 0.9, 0.97, 0.56, 1.0),
    (-2.27, 0.32, 1.0, 0.76, 0.86, 0.94, 0.54, 0.97),
]
CANOPY = (-1.0, 0.85)  # the stretch of roof and side glass that is the gold visor


def section(sill, flank, chine, shoulder, sh_y, roof, roof_y):
    """One cross-section, left to right: sill, rocker, chine, shoulder and roof on each side."""
    half = [(flank - 0.1, sill), (flank - 0.04, 0.44), (flank, chine), (shoulder, sh_y), (roof, roof_y)]
    return [(-x, y) for x, y in half] + [(x, y) for x, y in reversed(half)]


# Each band round a section and what it is made of; the canopy bands turn to glass between CANOPY's ends.
BANDS = ["ink", "paint", "paint", "upper", "roof", "upper", "paint", "paint", "ink"]


def body():
    bm = bmesh.new()
    rings = []
    for z, *rest in STATIONS:
        rings.append([bm.verts.new((x, y, z)) for x, y in section(*rest)])
    n = len(rings[0])
    for a, b, (za, *_), (zb, *_) in zip(rings, rings[1:], STATIONS, STATIONS[1:]):
        canopy = CANOPY[0] <= (za + zb) / 2 <= CANOPY[1]
        for k in range(n):
            f = bm.faces.new((a[k], b[k], b[(k + 1) % n], a[(k + 1) % n]))
            band = BANDS[k] if k < len(BANDS) else "ink"  # the last band closes the floor
            f.material_index = {"ink": 1, "paint": 0}.get(band, 2 if canopy else 0)
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj("body", bm, ["paint", "ink", "glass"])


def cylinder_x(name, mat, r, length, x, y, z, around):
    bm = bmesh.new()
    m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    bmesh.ops.create_cone(bm, cap_ends=True, segments=around, radius1=r, radius2=r, depth=length, matrix=m)
    return obj(name, bm, [mat])


def arches(car, around):
    """Cut the wheel arches out of the body; the cut faces take the cutter's ink, so each arch is lined."""
    for x, z in WHEELS:
        cutter = cylinder_x("arch", "ink", ARCH_R, 0.9, x, WHEEL_R, z, around)
        mod = modify(car, "BOOLEAN", operation="DIFFERENCE", object=cutter, solver="EXACT")
        mod.material_mode = "TRANSFER"
        apply_all(car)
        bpy.data.objects.remove(cutter)
    return car


def box(name, mat, size, at, turn=None):
    bm = bmesh.new()
    m = Matrix.Translation(at) @ (turn or Matrix()) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1, matrix=m)
    return obj(name, bm, [mat])


def prism(name, mat, pts, z, depth):
    """A flat triangle (or any outline) in x, y, `depth` thick, standing proud of the face at `z`."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y, z)) for x, y in pts]
    back = [bm.verts.new((x, y, z - depth)) for x, y in pts]
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    for k in range(len(pts)):
        bm.faces.new((front[k], back[k], back[(k + 1) % len(pts)], front[(k + 1) % len(pts)]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [mat])


def wheel(x, z, around):
    """A tyre, a flush dark aero cover with a spoke so it shows turning, and a thin orange ring on its face."""
    side = 1 if x > 0 else -1
    parts = [cylinder_x("tyre", "tyre", WHEEL_R, 0.34, x, WHEEL_R, z, around), cylinder_x("rim", "rim", 0.3, 0.36, x, WHEEL_R, z, around)]
    parts.append(box("spoke", "ink", (0.36, 0.05, 0.56), (x, WHEEL_R, z)))
    parts.append(cylinder_x("ring", "ring", 0.33, 0.012, x + side * 0.172, WHEEL_R, z, around))
    return parts


def wing():
    """The pop-out wing, up: two struts off the rear deck, a blade tipped a little nose-down, and end plates."""
    tilt = Matrix.Rotation(math.radians(-6), 4, "X")
    parts = [box("strut", "ink", (0.05, 0.34, 0.14), (x, 1.12, -1.95)) for x in (-0.5, 0.5)]
    parts.append(box("blade", "paint", (1.96, 0.04, 0.42), (0, 1.3, -1.98), tilt))
    parts += [box("plate", "paint", (0.03, 0.2, 0.46), (x, 1.24, -1.98)) for x in (-0.99, 0.99)]
    return parts


def build(around):
    car = [arches(body(), around)]
    # Dual triangular headlights, one in each corner of the nose, points in towards the middle.
    for s in (-1, 1):
        car.append(prism("headlight", "headlight", [(s * 0.72, 0.47), (s * 0.3, 0.55), (s * 0.62, 0.56)], 2.44, 0.03))
    car += [
        box("taillight", "taillight", (1.9, 0.05, 0.03), (0, 0.9, -2.285)),  # the plain bar across the tail
        box("diffuser", "ink", (1.8, 0.36, 0.06), (0, 0.48, -2.27)),  # the four rear nozzles sit in it
    ]
    car += [box("intake", "ink", (0.02, 0.16, 0.5), (s * 1.065, 0.6, -0.85)) for s in (-1, 1)]  # behind the doors
    car += wing()
    for x, z in WHEELS:
        car += wheel(x, z, around)
    return car


def model(budget):
    reset()
    return join(build(BUDGETS[budget]), "roadster", smooth=25)


def main():
    for budget in BUDGETS:
        write_glb(model(budget), os.path.join(OUT, f"roadster-{budget}.glb"))
    if "--render" in args():
        model("hi")
        path = os.path.abspath(args()[args().index("--render") + 1])
        render(path, (("", (5.5, -4.5, 2.6)), ("-rear", (-4.0, 5.0, 2.2)), ("-side", (7.5, 0, 1.0)), ("-front", (1.5, -7.0, 1.4))), target=(0, 0, 0.6))


main()
