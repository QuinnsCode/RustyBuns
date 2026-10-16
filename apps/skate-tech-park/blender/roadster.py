# The rocket roadster's body, modelled in Blender and written out at a few polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/roadster.py -- [--render out.png]
#
# A low two-seat electric roadster: a smooth body lofted through cross-sections and subdivided, wheel arches
# cut out of it, a tinted glass canopy, slit headlights, a full-width tail bar, mirrors, and turbine wheels.
# It keeps the footprint of the shared roadster (packages/models: about 4.7 m by 2.1 m, wheels of 0.42 m
# radius at x = +-1.0, z = 1.4 and -1.45), so the page can drop it over that one and keep the shared model's
# ten nozzle bells and hinged plate, which the plumes and the swap animate. Nose toward +z, in the game's frame.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, apply_all, args, join, material, modify, obj, render, reset, write_glb  # noqa: E402

BUDGETS = {"hi": None, "mid": 6000, "low": 2000}
PALETTE.update({
    "paint": (0.70, 0.05, 0.09, 0.22, 0.3), "ink": (0.09, 0.09, 0.1, 0.8, 0), "glass": (0.08, 0.09, 0.11, 0.08, 0.6),
    "tyre": (0.07, 0.07, 0.07, 0.9, 0), "rim": (0.75, 0.77, 0.8, 0.3, 0.85),
    "headlight": (1.0, 0.98, 0.92, 0.2, 0, 4.0), "taillight": (1.0, 0.16, 0.16, 0.2, 0, 4.0),
})
WHEELS = [(-1.0, 1.4), (1.0, 1.4), (-1.0, -1.45), (1.0, -1.45)]
WHEEL_R, ARCH_R = 0.42, 0.5

# Cross-sections along the car, tail to nose: z, half width, bottom, top. The loft is subdivided, which pulls
# the ends in, so the cage runs a little past the shared model's tail (-2.25) and nose (2.4).
BODY = [
    (-2.4, 0.9, 0.34, 0.86), (-2.25, 1.02, 0.26, 0.96), (-1.85, 1.06, 0.22, 1.0), (-1.45, 1.1, 0.22, 0.99),
    (-1.0, 1.06, 0.22, 0.97), (-0.5, 1.03, 0.22, 0.93), (0.0, 1.03, 0.22, 0.88), (0.5, 1.04, 0.22, 0.82),
    (1.0, 1.08, 0.22, 0.76), (1.4, 1.11, 0.22, 0.72), (1.85, 1.07, 0.24, 0.64), (2.2, 0.98, 0.28, 0.54),
    (2.5, 0.78, 0.34, 0.44),
]
# The canopy over the cockpit: z, half width, top; it sits down inside the body.
CANOPY = [(-1.45, 0.62, 0.95), (-1.1, 0.72, 1.12), (-0.55, 0.76, 1.27), (0.05, 0.76, 1.24), (0.55, 0.74, 1.04), (0.98, 0.7, 0.84)]


def sgnpow(v, p):
    return math.copysign(abs(v) ** p, v)


def loft(name, sections, around, square, tuck, mat):
    """A closed tube through cross-sections (z, half width, bottom, top): rounded boxes, narrower at the top by `tuck`."""
    bm = bmesh.new()
    rings = []
    for z, w, bottom, top in sections:
        ring = []
        for k in range(around):
            a = 2 * math.pi * k / around
            u, v = sgnpow(math.cos(a), square), sgnpow(math.sin(a), square)
            ring.append(bm.verts.new((w * u * (1 - tuck * max(0, v)), (bottom + top) / 2 + (top - bottom) / 2 * v, z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(around):
            j = (k + 1) % around
            bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
    for ring, face in ((rings[0], lambda f: f), (rings[-1], lambda f: f[::-1])):  # caps, fanned from the middle
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / len(ring))
        for k in range(around):
            bm.faces.new(face((ring[(k + 1) % around], ring[k], c)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [mat])


def bulge(z):
    """The fenders swell over each axle."""
    return sum(0.07 * math.exp(-(((z - wz) / 0.45) ** 2)) for wz in (1.4, -1.45))


def body(levels):
    o = loft("body", [(z, w + bulge(z), b, t) for z, w, b, t in BODY], 28, 0.42, 0.14, "paint")
    o.data.materials.append(material("ink"))
    modify(o, "SUBSURF", levels=levels, render_levels=levels)
    apply_all(o)
    for x, z in WHEELS:  # one cutter per wheel, in from the side as far as the tyre's inner face
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=ARCH_R, radius2=ARCH_R, depth=1.0,
                              matrix=Matrix.Translation((math.copysign(1.3, x), WHEEL_R, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
        cutter = obj("arch", bm, ["ink"])
        mod = modify(o, "BOOLEAN", operation="DIFFERENCE", solver="EXACT")
        mod.object = cutter
        apply_all(o)
        bpy.data.objects.remove(cutter)
    # Sills, the underside and the inside of each arch are dark; the rest is paint.
    for f in o.data.polygons:
        c, n = f.center, f.normal
        # The arch's own faces: its roof (on the cut, facing the axle) and its inner wall (where the cutter stopped).
        arch = False
        for _, z in WHEELS:
            to_axle = Vector((0, WHEEL_R - c.y, z - c.z))
            d = to_axle.length
            roof = abs(d - ARCH_R) < 0.02 and n.dot(to_axle / max(d, 1e-6)) > 0.7
            wall = d < ARCH_R and abs(abs(c.x) - 0.8) < 0.02 and abs(n.x) > 0.9
            arch = arch or roof or wall
        f.material_index = 1 if arch or c.y < 0.33 else 0
    return o


def canopy(levels):
    sections = [(z, w, 0.6, t) for z, w, t in CANOPY]
    o = loft("canopy", sections, 24, 0.5, 0.3, "glass")
    modify(o, "SUBSURF", levels=levels, render_levels=levels)
    apply_all(o)
    return o


def on_surface(tree, at, toward):
    """Where a ray from `at` along `toward` first meets the body."""
    hit = tree.ray_cast(Vector(at), Vector(toward).normalized())
    return hit[0], hit[1]


def lamp(name, mat, size, where, normal):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    rot = Vector((0, 0, 1)).rotation_difference(normal).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(where) @ rot, verts=bm.verts)
    return obj(name, bm, [mat])


def lights(car):
    tree = BVHTree.FromObject(car, bpy.context.evaluated_depsgraph_get())
    out = []
    for x in (-0.55, 0.55):  # slit headlights wrapping the nose's shoulders
        p, n = on_surface(tree, (x, 0.5, 4), (0, 0, -1))
        if p:
            out.append(lamp("headlight", "headlight", (0.26, 0.03, 0.03), p - n * 0.01, n))
    p, n = on_surface(tree, (0, 0.82, -4), (0, 0, 1))  # the tail bar
    if p:
        out.append(lamp("taillight", "taillight", (0.86, 0.03, 0.03), p - n * 0.01, n))
    for side in (-1, 1):  # mirrors on short stalks at the base of the windscreen
        p, n = on_surface(tree, (side * 3, 0.86, 0.75), (-side, 0, 0))
        if p:
            out.append(lamp("mirror", "paint", (0.12, 0.07, 0.05), p + Vector((side * 0.1, 0.06, 0)), Vector((side, 0, 0))))
    return out


def wheel(x, z, around):
    """Tyre with rounded shoulders, and a turbine rim: a dished disc of curved vanes round a hub."""
    side = 1 if x > 0 else -1
    bm = bmesh.new()
    prof = [(0.3, -0.15), (0.38, -0.155), (0.415, -0.12), (WHEEL_R, -0.06), (WHEEL_R, 0.06), (0.415, 0.12), (0.38, 0.155), (0.3, 0.15)]
    verts = [bm.verts.new((h, r, 0)) for r, h in prof + prof[:1]]
    edges = [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(1, 0, 0), angle=2 * math.pi, steps=around, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, WHEEL_R, z))
    tyre = obj("tyre", bm, ["tyre"])

    bm = bmesh.new()
    face = side * 0.13
    bmesh.ops.create_cone(bm, cap_ends=True, segments=around, radius1=0.3, radius2=0.3, depth=0.04,
                          matrix=Matrix.Translation((x + face - side * 0.03, WHEEL_R, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    for k in range(12):  # vanes, each tilted like a turbine blade
        a = 2 * math.pi * k / 12
        m = (Matrix.Translation((x + face, WHEEL_R, z)) @ Matrix.Rotation(a, 4, "X") @ Matrix.Translation((0, 0.17, 0))
             @ Matrix.Rotation(0.5, 4, "Y") @ Matrix.Diagonal((0.025, 0.22, 0.05, 1)))
        bmesh.ops.create_cube(bm, size=1, matrix=m)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.07, radius2=0.05, depth=0.06,
                          matrix=Matrix.Translation((x + face + side * 0.02, WHEEL_R, z)) @ Matrix.Rotation(side * math.pi / 2, 4, "Y"))
    return [tyre, obj("rim", bm, ["rim"])]


def main():
    reset()
    car = body(2)
    parts = [car, canopy(2), *lights(car)]
    for x, z in WHEELS:
        parts += wheel(x, z, 40)
    model = join(parts, "roadster", smooth=40)
    for budget, target in BUDGETS.items():
        write_glb(model, os.path.join(OUT, f"roadster-{budget}.glb"), target)
    lo, hi = [min(v.co[i] for v in model.data.vertices) for i in range(3)], [max(v.co[i] for v in model.data.vertices) for i in range(3)]
    print("bounds (Blender frame)", [round(v, 2) for v in lo], [round(v, 2) for v in hi])
    if "--render" in args():
        path = os.path.abspath(args()[args().index("--render") + 1])
        render(path, (("", (5.5, -4.5, 2.6)), ("-rear", (-4.0, 5.0, 2.2)), ("-side", (7.5, 0, 1.0))), target=(0, 0, 0.6))


main()
