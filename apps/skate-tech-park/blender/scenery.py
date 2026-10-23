# The scenery strewn over a park, modelled in Blender and written out at three polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/scenery.py -- [--render out.png]
#
# These are the tiny things that make the board read as giant (src/render/scenery.ts): pines, rocks, ferns,
# a tent, a trail sign. Each kind is one object, about a metre tall standing on y = 0 at the origin, and the
# page scales it to its spot's size. Thousands of them are drawn as one instanced mesh per kind, so the
# budgets are tight: a pine is a few hundred triangles at `hi` and under a hundred at `low`.
#
# The biome kinds are for the parks beyond the pine forests: a joshua tree and a saguaro for the desert, a
# palm for the swamps and the islands, an oak for the hardwood east, a snag (a dead bare trunk) and sage
# for the high and dry places. Which kinds a park uses is its biome in scenery.ts.
#
# Materials carry the colours; the page bakes them into vertex colours so one material draws a kind.
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, args, join, obj, render, reset, write_glb  # noqa: E402

hexes = {
    "bark": 0x6B4429, "bark-dark": 0x4E3220, "needles": 0x2F5D3A, "needles-light": 0x3B6E45, "needles-dark": 0x24503A,
    "aspen-bark": 0xE6E2D3, "aspen-leaf": 0xE0B43C, "oak-leaf": 0x4F7A37, "oak-leaf-dark": 0x3E6530,
    "stone": 0x8E857A, "stone-dark": 0x7D766C, "stone-light": 0x9C9388, "lichen": 0x7A8A5A,
    "cut-wood": 0xC9A06A, "board": 0xB58A4F, "canvas": 0xE2572B, "canvas-dark": 0xB8431F,
    "leaf": 0x3F6B3A, "leaf-light": 0x4D7A43, "frond": 0x5A8A3C, "frond-dark": 0x4A7A35,
    "stem": 0x4F7A37, "petal-yellow": 0xF2D03B, "petal-white": 0xF4F0E6, "petal-violet": 0x8E6FD0,
    "joshua-bark": 0x7A6A52, "joshua-leaf": 0x6E8A52, "joshua-dead": 0xA89C7A,
    "saguaro": 0x4F7A4A, "saguaro-dark": 0x3F6A3C, "spine": 0xD8D2BC,
    "palm-trunk": 0x8A7556, "palm-frond": 0x4A8A3A, "palm-frond-dark": 0x3A7030,
    "snag": 0x9A9082, "snag-dark": 0x6E675C, "sage": 0x8C9A80, "sage-light": 0xA3B094, "sequoia-bark": 0x8A4A2B,
}
PALETTE.update({k: ((h >> 16) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 0.95, 0) for k, h in hexes.items()})

# Triangle targets per kind at each budget. A kind with more is decimated down to it.
BUDGETS = {"hi": 600, "mid": 220, "low": 80}
TREE_BUDGETS = {"hi": 900, "mid": 320, "low": 110}

rng = random.Random(3)


def part(name, mat, bm, at=(0, 0, 0), scale=(1, 1, 1), rot=None):
    """One primitive as its own object, placed in the game's frame; join() puts them together."""
    m = Matrix.Translation(Vector(at)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return obj(name, bm, [mat])


def cone(r1, r2, h, segs=8):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(-math.pi / 2, 4, "X") @ Matrix.Translation((0, 0, h / 2)), verts=bm.verts)
    return bm


def ball(r, subdiv=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    return bm


def ruffle(bm, amount, cell=0.3, seed=0.0):
    """Push each vertex along its normal by noise, so a cone or a ball stops looking like a primitive."""
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * amount * noise.noise(Vector((v.co.x / cell, v.co.y / cell, v.co.z / cell + seed)))


def tilt(ax, ay, az=0):
    return Matrix.Rotation(az, 4, "Z") @ Matrix.Rotation(ay, 4, "Y") @ Matrix.Rotation(ax, 4, "X")


def crown(mat, r, at, n=3, spread=0.5, subdiv=1):
    """A lumpy crown: overlapping ruffled balls, one on top."""
    out = []
    for i in range(n):
        a = i * 2 * math.pi / n + 0.4
        b = ball(r * (0.85 + 0.3 * rng.random()), subdiv)
        ruffle(b, r * 0.12, r, i)
        out.append(part("crown", mat, b, (at[0] + math.cos(a) * r * spread, at[1] + (0.1 if i else 0) * r, at[2] + math.sin(a) * r * spread)))
    return out


# --- the forest and the meadow ---------------------------------------------------------------------------

def pine():
    out = [part("trunk", "bark", cone(0.07, 0.05, 0.3))]
    for k, (y, r, h, mat) in enumerate([(0.22, 0.36, 0.5, "needles"), (0.48, 0.28, 0.45, "needles-light"), (0.7, 0.18, 0.38, "needles-dark")]):
        c = cone(r, 0.02, h, 10)
        ruffle(c, 0.035, 0.18, k)
        out.append(part("tier", mat, c, (0, y, 0), rot=Matrix.Rotation(k * 0.4, 4, "Y")))
    return out


def sequoia():
    """A giant sequoia: a flared red trunk, bare for most of its height, with a narrow crown of flat tiers high up. Also the
    parks' big named trees (ground.ts), scaled to their own height."""
    out = [part("flare", "sequoia-bark", cone(0.16, 0.09, 0.14, 9))]
    t = cone(0.09, 0.05, 0.86, 9)
    ruffle(t, 0.008, 0.05, 9)
    out.append(part("trunk", "sequoia-bark", t, (0, 0.12, 0)))
    for k, (y, r, h) in enumerate([(0.42, 0.3, 0.2), (0.56, 0.27, 0.18), (0.7, 0.22, 0.17), (0.83, 0.15, 0.17)]):
        c = cone(r, 0.04, h, 9)
        ruffle(c, 0.02, 0.12, 20 + k)
        out.append(part("tier", "needles-dark" if k % 2 else "needles", c, (0, y, 0), rot=Matrix.Rotation(k * 0.5, 4, "Y")))
    return out


def aspen():
    t = cone(0.05, 0.03, 0.72, 7)
    out = [part("trunk", "aspen-bark", t)]
    out += crown("aspen-leaf", 0.22, (0, 0.78, 0), 3, 0.5)
    return out


def oak():
    out = [part("trunk", "bark-dark", cone(0.09, 0.06, 0.5, 8))]
    for a in (0.6, 2.7, 4.6):
        b = cone(0.035, 0.02, 0.32, 6)
        out.append(part("branch", "bark-dark", b, (0, 0.42, 0), rot=tilt(0, a, 0.7)))
    out += crown("oak-leaf", 0.3, (0, 0.78, 0), 4, 0.55)
    out += crown("oak-leaf-dark", 0.2, (0, 0.95, 0), 1)
    return out


def stump():
    t = cone(0.5, 0.42, 0.6, 12)
    ruffle(t, 0.03, 0.2)
    top = cone(0.36, 0.36, 0.02, 12)
    return [part("stump", "bark", t), part("cut", "cut-wood", top, (0, 0.59, 0))]


def rock():
    b = ball(0.5, 2)
    ruffle(b, 0.12, 0.45, 2)
    return [part("rock", "stone", b, (0, 0.35, 0), (1, 0.75, 0.9))]


def cairn():
    out = []
    for i in range(5):
        b = ball(0.34 - i * 0.06, 1)
        ruffle(b, 0.03, 0.2, i)
        out.append(part("stone", "stone-light" if i % 2 else "stone-dark", b, (0.02 * (-1) ** i, 0.17 + i * 0.16, 0), (1, 0.55, 1), rot=Matrix.Rotation(i * 0.7, 4, "Y")))
    return out


def sign():
    post = cone(0.03, 0.03, 0.8, 6)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    board = part("board", "board", bm, (0.05, 0.8, 0), (0.5, 0.2, 0.04))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    tip = part("tip", "board", bm, (0.32, 0.8, 0), (0.1, 0.2, 0.04), rot=Matrix.Rotation(math.pi / 4, 4, "Z"))
    return [part("post", "bark", post), board, tip]


def bush():
    out = []
    for i, (x, y, z, r, mat) in enumerate([(0, 0.27, 0, 0.36, "leaf"), (0.26, 0.2, 0.1, 0.26, "leaf-light"), (-0.2, 0.18, -0.14, 0.22, "leaf-light")]):
        b = ball(r, 1)
        ruffle(b, r * 0.15, r * 0.8, i)
        out.append(part("lump", mat, b, (x, y, z), (1, 0.78, 1)))
    return out


def fern():
    out = []
    for i in range(7):
        f = cone(0.07, 0.005, 0.55, 4)
        ruffle(f, 0.015, 0.1, i)
        out.append(part("frond", "frond" if i % 2 else "frond-dark", f, (0, 0.06, 0), rot=Matrix.Rotation(i * 2 * math.pi / 7, 4, "Y") @ Matrix.Translation((0.04, 0, 0)) @ Matrix.Rotation(0.95, 4, "Z")))
    return out


def flower():
    out = []
    for i, (dx, mat) in enumerate([(-0.14, "petal-yellow"), (0.1, "petal-white"), (0.0, "petal-violet")]):
        out.append(part("stem", "stem", cone(0.012, 0.012, 0.4, 4), (dx, 0, i * 0.1 - 0.1)))
        head = ball(0.065, 1)
        out.append(part("head", mat, head, (dx, 0.42, i * 0.1 - 0.1), (1, 0.6, 1)))
    return out


def prism(w, h, length):
    """A ridge tent's shape: a triangular prism on a flat base, the ridge along x."""
    bm = bmesh.new()
    a, b = -length / 2, length / 2
    vs = [bm.verts.new(c) for c in ((a, 0, -w / 2), (a, 0, w / 2), (a, h, 0), (b, 0, -w / 2), (b, 0, w / 2), (b, h, 0))]
    for f in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)):
        bm.faces.new([vs[i] for i in f])
    return bm


def tent():
    body = part("tent", "canvas", prism(1, 0.6, 1))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    door = part("door", "canvas-dark", bm, (0.5, 0.12, 0), (0.02, 0.24, 0.2))
    return [body, door]


# --- the biomes ------------------------------------------------------------------------------------------

def spiky_ball(r, mat, at, rot=None):
    """A joshua tree's tuft: a ball with spikes leaning outward."""
    out = [part("tuft", mat, ball(r * 0.6, 1), at)]
    for i in range(10):
        a, b = rng.random() * 2 * math.pi, rng.random() * math.pi
        d = Vector((math.sin(b) * math.cos(a), math.cos(b), math.sin(b) * math.sin(a)))
        spike = cone(r * 0.12, 0.004, r * 1.4, 4)
        out.append(part("spike", mat, spike, (at[0] + d.x * r * 0.2, at[1] + d.y * r * 0.2, at[2] + d.z * r * 0.2), rot=d.to_track_quat("Y", "Z").to_matrix().to_4x4()))
    return out


def joshua():
    t = cone(0.07, 0.05, 0.45, 7)
    ruffle(t, 0.012, 0.08, 4)
    out = [part("trunk", "joshua-bark", t)]
    for i, (a, lean) in enumerate([(0.3, 0.55), (2.4, 0.7), (4.3, 0.45)]):
        rot = Matrix.Rotation(a, 4, "Y") @ Matrix.Rotation(lean, 4, "Z")
        arm = cone(0.045, 0.035, 0.38, 6)
        out.append(part("arm", "joshua-bark", arm, (0, 0.42, 0), rot=rot))
        tip = rot @ Vector((0, 0.38, 0))
        out += spiky_ball(0.16, "joshua-leaf", (tip.x, 0.42 + tip.y, tip.z))
        # dead leaves hang below the tuft as a skirt
        skirt = cone(0.1, 0.06, 0.12, 7)
        out.append(part("skirt", "joshua-dead", skirt, (tip.x * 0.9, 0.42 + tip.y * 0.9 - 0.08, tip.z * 0.9)))
    return out


def ribbed(r, h, segs=14):
    """A saguaro's column: ribs run up it, so every other vertex round the ring is pulled in."""
    bm = cone(r, r * 0.85, h, segs)
    for v in bm.verts:
        a = math.atan2(v.co.z, v.co.x)
        k = 0.88 + 0.12 * math.cos(a * segs / 2)
        v.co.x *= k
        v.co.z *= k
    return bm


def saguaro():
    body = ribbed(0.11, 0.9)
    out = [part("body", "saguaro", body), part("cap", "saguaro-dark", ball(0.095, 1), (0, 0.9, 0), (1, 0.7, 1))]
    for a, y, h in ((0.2, 0.42, 0.34), (3.3, 0.55, 0.26)):
        elbow = ribbed(0.06, 0.2, 10)
        rot = Matrix.Rotation(a, 4, "Y") @ Matrix.Rotation(-math.pi / 2, 4, "Z")
        out.append(part("elbow", "saguaro", elbow, (0, y, 0), rot=rot))
        end = rot @ Vector((0, 0.2, 0))
        arm = ribbed(0.06, h, 10)
        out.append(part("arm", "saguaro-dark", arm, (end.x, y + end.y, end.z)))
        out.append(part("tip", "saguaro-dark", ball(0.052, 1), (end.x, y + end.y + h, end.z), (1, 0.7, 1)))
    return out


def palm():
    out = []
    y, x, seg = 0.0, 0.0, 6
    for i in range(seg):  # a trunk that leans, in stacked rings
        s = cone(0.06 - i * 0.004, 0.055 - i * 0.004, 0.16, 8)
        out.append(part("ring", "palm-trunk", s, (x, y, 0), rot=Matrix.Rotation(-0.12, 4, "Z")))
        y += 0.155
        x += 0.02 + i * 0.004
    for i in range(8):
        f = cone(0.075, 0.005, 0.5, 4)
        ruffle(f, 0.012, 0.1, i)
        for v in f.verts:  # a frond arches: level at the crown, bending over toward its tip
            v.co.x -= 0.22 * (v.co.y / 0.5) ** 2
        rot = Matrix.Rotation(i * 2 * math.pi / 8 + 0.2, 4, "Y") @ Matrix.Rotation(math.pi / 2 + 0.1 + 0.25 * (i % 2), 4, "Z")
        out.append(part("frond", "palm-frond" if i % 2 else "palm-frond-dark", f, (x, y + 0.02, 0), rot=rot))
    out.append(part("crown", "palm-frond-dark", ball(0.07, 1), (x, y, 0)))
    return out


def snag():
    t = cone(0.08, 0.035, 0.95, 7)
    ruffle(t, 0.015, 0.12, 6)
    # a broken top: shear the last ring so it ends in a splinter
    for v in t.verts:
        if v.co.y > 0.9:
            v.co.y += 0.12 * (v.co.x + 0.03) / 0.035
    out = [part("trunk", "snag", t)]
    for a, y, lean, h in ((0.5, 0.55, 1.1, 0.3), (2.9, 0.7, 0.9, 0.22), (4.4, 0.4, 1.25, 0.2)):
        b = cone(0.025, 0.008, h, 5)
        out.append(part("branch", "snag-dark", b, (0, y, 0), rot=Matrix.Rotation(a, 4, "Y") @ Matrix.Rotation(lean, 4, "Z")))
    return out


def sage():
    out = []
    for i, (x, z, r, mat) in enumerate([(0, 0, 0.36, "sage"), (0.3, 0.12, 0.24, "sage-light"), (-0.22, -0.2, 0.26, "sage-light"), (0.05, -0.3, 0.2, "sage")]):
        b = ball(r, 1)
        ruffle(b, r * 0.2, r * 0.6, 10 + i)
        out.append(part("lump", mat, b, (x, r * 0.55, z), (1, 0.6, 1)))
    return out


KINDS = {
    "pine": pine, "aspen": aspen, "oak": oak, "stump": stump, "rock": rock, "cairn": cairn, "sign": sign, "bush": bush, "fern": fern,
    "flower": flower, "tent": tent, "joshua": joshua, "saguaro": saguaro, "palm": palm, "snag": snag, "sage": sage, "sequoia": sequoia,
}
TREES = {"pine", "aspen", "oak", "joshua", "saguaro", "palm", "snag", "sequoia"}


def main():
    opts = args()
    for budget in BUDGETS:
        reset()
        rng.seed(3)
        built = []
        for i, (name, build) in enumerate(KINDS.items()):
            o = join(build(), name, smooth=40)
            o.location = ((i % 8) * 1.6 - 5.6, (i // 8) * 2.2 - 1.1, 0)  # a row for the render; the page reads each object at its origin
            built.append(o)
        if "--render" in opts and budget == "mid":
            out = opts[opts.index("--render") + 1]
            render(out, [("", (0, -17, 9)), ("-close", (-4.5, -6, 3))], target=(0, 0, 0.5), size=(1600, 900))
        for o in built:
            o.location = (0, 0, 0)
        write_set(built, budget)


def write_set(built, budget):
    """Every kind in one GLB, each object named for its kind, decimated to its budget."""
    import bpy
    from common import modify, apply_all, tris
    path = os.path.join(OUT, f"scenery-{budget}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in built:
        target = (TREE_BUDGETS if o.name in TREES else BUDGETS)[budget]
        if tris(o) > target:
            modify(o, "DECIMATE", ratio=target / tris(o), use_collapse_triangulate=True)
            apply_all(o)
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_normals=True, export_materials="EXPORT")
    print(f"{budget}: " + ", ".join(f"{o.name} {tris(o)}" for o in built) + f" -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")


main()
