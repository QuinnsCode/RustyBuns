# The giant fingerboard, modelled in Blender and written out at a few polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/fingerboard.py -- [--render out.png]
#
# Same size and layout as `fingerboard()` in src/models.ts (deck 4.4 m by 1.25 m, top at 0.52 m, wheels of
# 0.19 m radius at x = +-0.5, z = +-0.95), so the sim's collision box still fits what you see. Everything is
# built in the game's frame (y up, nose toward +z) and turned into Blender's z-up frame at the end; the glTF
# exporter turns it back. Each material is named after a slot of the parts picker (deck, accent, edge, grip,
# steel, bushing, tyre, core) and the page swaps in its own materials by those names, so colours stay live.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "models")
# Triangles per budget. "hi" keeps everything the modifiers made.
BUDGETS = {"hi": None, "mid": 6000, "low": 1500}

LENGTH, WIDTH = 4.4, 1.25
TOP, THICK, CONCAVE, FLAT, RISE, NOSE = 0.52, 0.1, 0.04, 1.45, 0.34, 0.6
TRUCK_Z, WHEEL_R, WHEEL_H, WHEEL_X = 0.95, 0.19, 0.11, 0.5
# Colours here are only for the preview render: the page paints every slot from the parts picker.
MATERIALS = {
    "deck": (0.85, 0.34, 0.17, 0.55, 0), "accent": (0.95, 0.91, 0.82, 0.6, 0), "edge": (0.85, 0.72, 0.54, 0.7, 0),
    "grip": (0.11, 0.11, 0.12, 0.95, 0), "steel": (0.65, 0.67, 0.71, 0.3, 0.9), "bushing": (0.91, 0.83, 0.29, 0.8, 0),
    "tyre": (0.95, 0.94, 0.89, 0.45, 0), "core": (0.17, 0.17, 0.17, 0.5, 0),
}


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    r, g, b, rough, metal = MATERIALS[name]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for m in mats:
        o.data.materials.append(material(m))
    return o


def modify(o, kind, **props):
    m = o.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


# ---- deck ----

def lift(z):
    a = abs(z)
    return 0 if a <= FLAT else RISE * min(1, (a - FLAT) / (LENGTH / 2 - FLAT)) ** 1.6


def half_width(z):
    d = (abs(z) - (LENGTH / 2 - NOSE)) / NOSE
    return WIDTH / 2 * (1 if d <= 0 else math.sqrt(max(0, 1 - d * d)))


def us(cols):
    return [j / cols * 2 - 1 for j in range(cols + 1)]


def deck():
    """The top face as a dense grid (dish, kicks, round ends), thickened down, edges rounded, then painted by region."""
    bm = bmesh.new()
    cols, mid, end, straight = 24, 80, 16, LENGTH / 2 - NOSE

    def at(z, x):
        return (x, TOP + lift(z) + CONCAVE * (x / (WIDTH / 2)) ** 2, z)

    # Rows down the straight middle, then each round end as a square squeezed onto a half-disk (no row closes
    # to a point, so the tips stay as clean as the middle).
    rows = []
    for k in range(end, 0, -1):
        v = k / end
        rows.append([(-straight - NOSE * v * math.sqrt(1 - u * u / 2), WIDTH / 2 * u * math.sqrt(1 - v * v / 2)) for u in us(cols)])
    for i in range(mid + 1):
        z = -straight + 2 * straight * i / mid
        rows.append([(z, WIDTH / 2 * u) for u in us(cols)])
    for k in range(1, end + 1):
        v = k / end
        rows.append([(straight + NOSE * v * math.sqrt(1 - u * u / 2), WIDTH / 2 * u * math.sqrt(1 - v * v / 2)) for u in us(cols)])
    grid = [[bm.verts.new(at(z, x)) for z, x in row] for row in rows]
    for i in range(len(grid) - 1):
        for j in range(cols):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    o = obj("deck", bm, ["deck", "accent", "edge", "grip"])
    modify(o, "SOLIDIFY", thickness=THICK, offset=-1, use_even_offset=True)
    modify(o, "BEVEL", width=0.025, segments=3, limit_method="ANGLE", angle_limit=math.radians(50))
    apply_all(o)
    # Paint: top inside a thin border is grip, the sides are ply, the underside is the graphic with a band of accent.
    for f in o.data.polygons:
        c, n = f.center, f.normal
        if n.y > 0.6:
            f.material_index = 3 if abs(c.x) < half_width(c.z) - 0.03 else 2
        elif n.y < -0.6:
            f.material_index = 1 if abs(c.z) < 0.45 or 1.6 < abs(c.z) < 1.75 else 0
        else:
            f.material_index = 2
    return o


# ---- trucks ----

def box(bm, size, at, rot=None):
    m = Matrix.Translation(at) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1, matrix=m)


def cyl(bm, r1, r2, h, at, rot=None, seg=16):
    m = Matrix.Translation(at) @ (rot or Matrix.Identity(4))
    # create_cone builds along z; turn it onto y so a bare call stands upright like three's CylinderGeometry.
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=m @ Matrix.Rotation(-math.pi / 2, 4, "X"))


def rounded(name, mats, build, width, segments=2):
    bm = bmesh.new()
    build(bm)
    o = obj(name, bm, mats)
    modify(o, "BEVEL", width=width, segments=segments, limit_method="ANGLE", angle_limit=math.radians(40))
    apply_all(o)
    return o


def truck(z):
    toward = -1 if z > 0 else 1  # the kingpin leans in toward the middle of the board
    lean = Matrix.Rotation(toward * 0.5, 4, "X")
    across = Matrix.Rotation(math.pi / 2, 4, "Z")

    def steel(bm):
        box(bm, (0.5, 0.035, 0.4), Vector((0, 0.372, z)))  # baseplate
        # Hanger: a wide, flat-bottomed bar that narrows to the axle, and the pivot arm reaching up to the cup.
        box(bm, (0.72, 0.09, 0.15), Vector((0, 0.205, z)))
        box(bm, (0.26, 0.11, 0.2), Vector((0, 0.235, z + toward * 0.02)))
        box(bm, (0.09, 0.07, 0.2), Vector((0, 0.3, z - toward * 0.11)), Matrix.Rotation(-toward * 0.6, 4, "X"))
        cyl(bm, 0.03, 0.03, 0.24, Vector((0, 0.3, z + toward * 0.03)), lean, 12)  # kingpin
        cyl(bm, 0.045, 0.045, 0.02, Vector((0, 0.18, z + toward * 0.09)), lean, 6)  # kingpin nut
        for x in (-1, 1):
            cyl(bm, 0.04, 0.04, 0.03, Vector((x * 0.625, 0.19, z)), across, 6)  # axle nuts
        cyl(bm, 0.028, 0.028, 1.24, Vector((0, 0.19, z)), across, 12)  # axle
        for x in (-1, 1):  # mounting bolt heads on the grip, two per side
            for dz in (-0.12, 0.12):
                cyl(bm, 0.035, 0.035, 0.02, Vector((x * 0.16, TOP + 0.01, z + dz)), None, 10)

    def rubber(bm):
        box(bm, (0.52, 0.03, 0.42), Vector((0, 0.405, z)))  # riser pad
        cyl(bm, 0.08, 0.07, 0.05, Vector((0, 0.29, z + toward * 0.025)), lean, 18)  # bushings, above and below the hanger
        cyl(bm, 0.07, 0.08, 0.04, Vector((0, 0.17, z + toward * 0.085)), lean, 18)
        cyl(bm, 0.05, 0.05, 0.05, Vector((0, 0.31, z - toward * 0.17)), Matrix.Rotation(-toward * 0.6, 4, "X"), 14)  # pivot cup

    return rounded("steel", ["steel"], steel, 0.012), rounded("bushing", ["bushing"], rubber, 0.01)


# ---- wheels ----

def lathe(name, mat, profile, steps, at):
    """Spin a (radius, offset-along-axle) profile about an axle along x."""
    bm = bmesh.new()
    verts = [bm.verts.new((h, r, 0)) for r, h in profile]
    edges = [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(1, 0, 0), angle=2 * math.pi, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [mat])


def wheel(x, z):
    r, h, side = WHEEL_R, WHEEL_H, 1 if x > 0 else -1
    # Urethane: rounded lips on both faces, a slight crown on the contact patch, dished in to the core.
    lips = [(r - 0.045, 1), (r - 0.02, 0.97), (r - 0.006, 0.85), (r, 0.6), (r + 0.002, 0.2), (r + 0.002, -0.2), (r, -0.6), (r - 0.006, -0.85), (r - 0.02, -0.97), (r - 0.045, -1)]
    tyre_profile = [(0.105, 0.86)] + lips + [(0.105, -0.86), (0.105, 0.86)]  # closed, so its normals face out
    tyre = lathe("tyre", "tyre", [(a, b * h) for a, b in tyre_profile], 48, Vector((x, r, z)))
    # Core: a hub that sits proud of the urethane with a bearing ring and the axle hole.
    core_profile = [(0.03, 1.08), (0.075, 1.08), (0.085, 1.0), (0.105, 0.9), (0.105, -0.9), (0.085, -1.0), (0.075, -1.08), (0.03, -1.08), (0.03, 1.08)]
    core = lathe("core", "core", [(a, b * h * side) for a, b in core_profile], 32, Vector((x, r, z)))
    return tyre, core


# ---- build, budget, export ----

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = [deck()]
    for z in (-TRUCK_Z, TRUCK_Z):
        parts += truck(z)
        for x in (-WHEEL_X, WHEEL_X):
            parts += wheel(x, z)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    board = bpy.context.active_object
    board.name = board.data.name = "fingerboard"
    # Game frame (y up, nose +z) to Blender's (z up, nose -y); the exporter turns it back.
    board.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    return board


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def export(board, budget, target):
    bpy.ops.object.select_all(action="DESELECT")
    lod = board.copy()
    lod.data = board.data.copy()
    bpy.context.collection.objects.link(lod)
    if target:
        modify(lod, "DECIMATE", ratio=min(1, target / tris(board)), use_collapse_triangulate=True)
        apply_all(lod)
    lod.select_set(True)
    path = os.path.join(OUT, f"fingerboard-{budget}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="EXPORT")
    print(f"{budget}: {tris(lod)} triangles -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")
    bpy.data.objects.remove(lod)


def render(board, path):
    """A quick three-quarter look at the board, to judge the model by eye without the game."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    world = bpy.data.worlds.new("world")
    world.color = (0.75, 0.8, 0.85)
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    stem, ext = os.path.splitext(path)
    for name, where in (("", (5.5, 4.2, 3.2)), ("-under", (3.2, 2.6, -1.6))):  # three-quarter from above, then from below
        cam.location = where
        cam.rotation_euler = (Vector((0, 0, 0.4)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = stem + name + ext
        bpy.ops.render.render(write_still=True)


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    os.makedirs(OUT, exist_ok=True)
    board = build()
    for budget, target in BUDGETS.items():
        export(board, budget, target)
    if "--render" in args:
        render(board, os.path.abspath(args[args.index("--render") + 1]))


main()
