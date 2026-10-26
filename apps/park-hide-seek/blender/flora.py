# Bushes and cacti, modelled in Blender for the park's ground cover.
#
#   blender -b --factory-startup -P apps/park-hide-seek/blender/flora.py -- [--render out-dir]
#
# Writes public/models/flora.glb: one mesh object per plant, origin at the foot, in the game's frame and units
# (metres, y up). The page (src/ui/flora.ts) bakes each material's colour into vertex colours and draws every
# plant as an instanced mesh, tinting each one a little, so a plant is one draw call however many there are.
# Nothing here is tied to the game: any page that wants a shrub or a saguaro can load the file.
#
# The look matches the characters: chunky, flat-shaded, low-poly, read from 30 m.
#   bush0..2  a shrub one metre across (the game scales it by its size): a few lumpy leaf clumps, darker
#             inside and lighter on top, over a woody base. 0 is a round shrub, 1 a wide low one, 2 has berries.
#   saguaro0..1  a ribbed column about 7 m tall with arms that elbow up, and cream flowers on the crowns.
#   barrel    a squat ribbed barrel cactus with a ring of yellow flowers.
#   pear      prickly pear: flat pads stacked on pads, magenta fruit on the rims.
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, args, hexrgb, join, obj, render, reset, stage, tris, write_glb  # noqa: E402


def c(h, rough=0.9):
    return (*hexrgb(h), rough, 0.0)


PALETTE.update({
    "leaf": c("#5f8a3a"), "leafLit": c("#86a948"), "leafDeep": c("#3a5a2a"), "twig": c("#5a4030"),
    "berry": c("#b8323a", 0.5),
    "cactus": c("#5f8a52", 0.7), "cactusDeep": c("#46703f", 0.7), "bloom": c("#f4ecd0", 0.6), "bloomEye": c("#e6b93a", 0.6),
    "pad": c("#7aa457", 0.7), "fruit": c("#b0306a", 0.6), "spine": c("#e8dcb0", 0.6),
})

PLANTS = {}


def plant(name, *parts):
    PLANTS[name] = join(list(parts), name)


# ---- shapes -------------------------------------------------------------------------------------------------
def blob(name, mat, at, radii, seed, sub=2, bump=0.22, flat_base=None, crinkle=0.0):
    """A lumpy clump: an icosphere pushed in and out by noise (and `crinkle`, a random jitter per point, for
    leafy edges), optionally sliced flat underneath."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((seed * 7.1, seed * 3.3, seed * 5.7))
    jit = random.Random(seed)
    for v in bm.verts:
        n = v.co.normalized()
        k = 1 + bump * noise.noise(n * 1.8 + off) + bump * 0.5 * noise.noise(n * 4.0 + off) + jit.uniform(-crinkle, crinkle)
        v.co = Vector((n.x * radii[0] * k, n.y * radii[1] * k, n.z * radii[2] * k)) + Vector(at)
        if flat_base is not None and v.co.y < flat_base:
            v.co.y = flat_base
    return obj(name, bm, [mat])


def tube(name, mat, path, seg=12, ribs=0, rib=0.0, cap=True, base=True):
    """Rings along a path of (x, y, z, radius) points, each square to the path, so arms can bend. `ribs` grooves
    the surface into that many ribs; `cap` rounds the far end into a dome, `base` closes the near one."""
    bm = bmesh.new()
    pts = [Vector(p[:3]) for p in path]
    rows = []
    prev_side = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_side is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            side = t.cross(up).normalized()
        else:
            side = (prev_side - t * prev_side.dot(t)).normalized()  # carry the frame along so rings don't twist
        prev_side = side
        other = t.cross(side)
        r = path[i][3]
        row = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            k = 1 - rib * (0.5 - 0.5 * math.cos(ribs * a)) if ribs else 1
            row.append(bm.verts.new(p + (side * math.cos(a) + other * math.sin(a)) * r * k))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for j in range(seg):
            bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    if cap:
        t = (pts[-1] - pts[-2]).normalized()
        tip = bm.verts.new(pts[-1] + t * path[-1][3] * 0.55)
        for j in range(seg):
            bm.faces.new((rows[-1][j], rows[-1][(j + 1) % seg], tip))
    if base:
        bm.faces.new(rows[0])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [mat])


def flower(name, mat, at, r, n=5, lift=0.0):
    """A little star of petals facing up, a cone at its heart."""
    bm = bmesh.new()
    x, y, z = at
    mid = bm.verts.new((x, y + r * 0.3 + lift, z))
    ring = []
    for j in range(n * 2):
        a = math.pi * j / n
        rr = r if j % 2 == 0 else r * 0.45
        ring.append(bm.verts.new((x + math.cos(a) * rr, y + lift, z + math.sin(a) * rr)))
    for j in range(len(ring)):
        bm.faces.new((ring[j], ring[(j + 1) % len(ring)], mid))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [mat])


def arc(start, out, up, r0, r1, n=7):
    """An arm path: out of the trunk sideways along `out`, then elbowing up to `up` metres above where it left."""
    sx, sy, sz = start
    ox, oz = out
    reach = math.hypot(ox, oz)
    pts = []
    for i in range(n):
        a = i / (n - 1) * math.pi / 2  # a quarter turn: sideways first, straight up at the end
        pts.append((sx + ox * math.sin(a), sy + (1 - math.cos(a)) * reach * 0.9, sz + oz * math.sin(a), r0 + (r1 - r0) * i / (n - 1)))
    x, y, z, _ = pts[-1]
    return pts + [(x, y + up * 0.5, z, r1), (x, y + up, z, r1 * 0.95)]


# ---- bushes -------------------------------------------------------------------------------------------------
def bush(name, seed, wide=1.0, berries=False):
    """Leafy lumps on a dark core, laid over a dome: deep green low down, lit on top, a few twigs poking out."""
    rnd = random.Random(seed)
    parts = [blob(f"{name}core", "leafDeep", (0, 0.5, 0), (0.82 * wide, 0.6, 0.82 * wide), seed, sub=2, bump=0.12, flat_base=0.0)]
    n = 22
    lobes = []
    for k in range(n):
        # Fibonacci points over the upper part of the dome, so the lumps cover it evenly
        e = math.asin(0.05 + 0.95 * (k + 0.5) / n)
        a = k * 2.39996 + rnd.uniform(-0.25, 0.25)
        d = math.cos(e) * 0.74 * wide
        y = 0.38 + math.sin(e) * 0.7
        r = rnd.uniform(0.27, 0.37) * (1.15 - 0.3 * math.sin(e))
        mat = "leafLit" if math.sin(e) > 0.72 else "leaf" if math.sin(e) > 0.3 else "leafDeep"
        parts.append(blob(f"{name}lobe{k}", mat, (math.cos(a) * d, y, math.sin(a) * d), (r, r * 0.8, r),
                          seed * 40 + k, sub=1, bump=0.3, flat_base=0.0, crinkle=0.12))
        lobes.append((Vector((math.cos(a) * d, y, math.sin(a) * d)), r))
    for k in range(2):
        a = rnd.uniform(0, 2 * math.pi)
        parts.append(tube(f"{name}twig{k}", "twig", [(math.cos(a) * 0.3 * wide, 0.9, math.sin(a) * 0.3 * wide, 0.022),
                                                      (math.cos(a) * 0.55 * wide, 1.28, math.sin(a) * 0.55 * wide, 0.01)],
                          seg=4, cap=False, base=False))
    if berries:
        # berries in little bunches on the outside of the clumps
        for k, (at, r) in enumerate(lobes[2::2]):
            out = Vector((at.x, at.y - 0.45, at.z)).normalized()
            for j in range(3):
                q = at + out * r * 0.95 + Vector((rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06)))
                parts.append(blob(f"{name}berry{k}_{j}", "berry", tuple(q), (0.05, 0.05, 0.05), k, sub=0, bump=0.0))
    plant(name, *parts)


# ---- cacti --------------------------------------------------------------------------------------------------
RIBS = 10


def saguaro(name, seed, height, arms):
    rnd = random.Random(seed)
    r = 0.32
    trunk = [(0, 0, 0, r * 1.05), (0, height * 0.15, 0, r), (0, height * 0.7, 0, r * 0.97), (0, height * 0.94, 0, r * 0.9)]
    parts = [tube(f"{name}trunk", "cactus", trunk, seg=RIBS * 2, ribs=RIBS, rib=0.16)]
    crowns = [(0, height * 0.94 + r * 0.5, 0, r)]
    for k, (at, ang, out, up) in enumerate(arms):
        ox, oz = math.cos(ang) * out, math.sin(ang) * out
        path = arc((0, height * at, 0), (ox, oz), up, r * 0.78, r * 0.72)
        parts.append(tube(f"{name}arm{k}", "cactus", path, seg=RIBS * 2 - 4, ribs=RIBS - 2, rib=0.16, base=False))
        tip = path[-1]
        crowns.append((tip[0], tip[1] + tip[3] * 0.5, tip[2], tip[3]))
    for k, (x, y, z, rr) in enumerate(crowns):
        for j in range(rnd.randint(2, 4)):
            a = rnd.uniform(0, 2 * math.pi)
            d = rr * rnd.uniform(0.1, 0.45)
            fx, fz = x + math.cos(a) * d, z + math.sin(a) * d
            parts.append(flower(f"{name}bloom{k}_{j}", "bloom", (fx, y - rr * 0.18, fz), 0.11, n=5, lift=0.0))
            parts.append(blob(f"{name}eye{k}_{j}", "bloomEye", (fx, y - rr * 0.12, fz), (0.035, 0.03, 0.035), j, sub=0, bump=0.0))
    plant(name, *parts)


def barrel(name, seed):
    rnd = random.Random(seed)
    rings = [(0, 0.0, 0, 0.32), (0, 0.15, 0, 0.4), (0, 0.38, 0, 0.42), (0, 0.6, 0, 0.36), (0, 0.72, 0, 0.24)]
    parts = [tube(f"{name}body", "cactus", rings, seg=28, ribs=14, rib=0.2)]
    for j in range(7):
        a = 2 * math.pi * j / 7 + rnd.uniform(-0.2, 0.2)
        parts.append(flower(f"{name}bloom{j}", "bloomEye", (math.cos(a) * 0.17, 0.76, math.sin(a) * 0.17), 0.08, n=6))
    plant(name, *parts)


def pear(name, seed):
    rnd = random.Random(seed)
    parts = []

    def pad(k, at, yaw, tilt, size):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        turn = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, "Y") @ Matrix.Rotation(tilt, 4, "Z")
        for v in bm.verts:
            v.co = turn @ Vector((v.co.x * size * 0.78, v.co.y * size, v.co.z * 0.07))
        parts.append(obj(f"{name}pad{k}", bm, ["pad"]))
        return turn @ Vector((0, size * 0.9, 0)), turn

    k = 0
    tips = []
    for base in range(3):
        yaw = base * 2.1 + rnd.uniform(-0.3, 0.3)
        tilt = rnd.uniform(-0.3, 0.3)
        top, _ = pad(k, Vector((math.cos(yaw) * 0.15, 0.36, math.sin(yaw) * 0.15)), yaw, tilt, 0.38)
        k += 1
        for up in range(2):
            t2 = tilt + (0.5 if up else -0.5) + rnd.uniform(-0.2, 0.2)
            y2 = yaw + rnd.uniform(-0.6, 0.6)
            dirv = Matrix.Rotation(y2, 4, "Y") @ Matrix.Rotation(t2, 4, "Z") @ Vector((0, 0.3, 0))
            top2, _ = pad(k, top + dirv * 0.85, y2, t2, 0.3)
            k += 1
            if rnd.random() < 0.6:
                d3 = Matrix.Rotation(y2, 4, "Y") @ Matrix.Rotation(t2 * 0.5, 4, "Z") @ Vector((0, 0.22, 0))
                top2, _ = pad(k, top2 + d3 * 0.85, y2 + 0.4, t2 * 0.5, 0.22)
                k += 1
            tips.append(top2)
    for j, t in enumerate(tips):
        parts.append(blob(f"{name}fruit{j}", "fruit", (t.x, t.y + 0.03, t.z), (0.05, 0.07, 0.05), j, sub=0, bump=0.0))
    plant(name, *parts)


def preview(out):
    for o in PLANTS.values():
        o.hide_render = True
    stage(ground="#c9a46a", sky=(0.95, 0.86, 0.69))
    spots = {"bush0": (-4.2, 0), "bush1": (-1.2, 0.4), "bush2": (1.8, 0), "barrel": (2.4, -0.4), "pear": (3.6, -0.2),
             "saguaro0": (5.8, 2.0), "saguaro1": (9.0, 3.0)}
    scale = {"bush0": 1.4, "bush1": 1.4, "bush2": 1.4}
    for name, (x, y) in spots.items():
        o = PLANTS[name].copy()
        o.hide_render = False
        import bpy
        bpy.context.collection.objects.link(o)
        s = scale.get(name, 1)
        o.matrix_world = Matrix.Translation((x, y, 0)) @ Matrix.Scale(s, 4)
    render(os.path.join(out, "flora.png"), (("", (3.0, -18.0, 3.5)),), target=(3.0, 0, 2.8), size=(1800, 900), lens=35)
    render(os.path.join(out, "flora.png"), (("-bushes", (-1.2, -8.5, 3.0)),), target=(-1.2, 0, 0.9), size=(1400, 700), lens=40)
    render(os.path.join(out, "flora.png"), (("-cacti", (6.0, -6.0, 2.0)),), target=(5.0, 1.0, 2.5), size=(1200, 1000), lens=35)


def main():
    reset()
    bush("bush0", 1)
    bush("bush1", 2, wide=1.25)
    bush("bush2", 3, berries=True)
    saguaro("saguaro0", 4, 7.0, [(0.45, 0.3, 0.9, 1.6), (0.55, 3.4, 0.8, 1.3)])
    saguaro("saguaro1", 5, 6.0, [(0.5, 1.2, 0.75, 1.1), (0.4, 2.6, 0.95, 1.5), (0.62, 4.5, 0.7, 0.9)])
    barrel("barrel", 6)
    pear("pear", 7)
    for name, o in PLANTS.items():
        print(f"  {name}: {tris(o)}")
    write_glb(list(PLANTS.values()), os.path.join(OUT, "flora.glb"))
    if "--render" in args():
        preview(os.path.abspath(args()[args().index("--render") + 1]))


main()
