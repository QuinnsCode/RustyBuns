# What the model scripts here share (a trimmed copy of apps/skate-tech-park/blender/common.py, plus shape
# helpers): materials by name, bmesh to object, lofted rings, joining, the turn from the game's frame (y up,
# forward +z) into Blender's (z up, forward -y), GLB output and preview renders.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models")
# name -> (r, g, b, roughness, metalness[, glow]), colours in sRGB like a hex code
PALETTE = {}
# The game's frame into Blender's: y up becomes z up, +z forward becomes -y.
GAME_TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    r, g, b, rough, metal, *glow = PALETTE[name]  # a sixth value makes it glow that strongly
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (linear(r), linear(g), linear(b), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if glow:
        bsdf.inputs["Emission Color"].default_value = (linear(r), linear(g), linear(b), 1)
        bsdf.inputs["Emission Strength"].default_value = glow[0]
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


def R(y, rx, rz=None, cx=0.0, cz=0.0, tilt=0.0, jag=0.0):
    """One ring of a loft: at height y, radii rx (across) and rz (front to back), centred at (cx, cz). `tilt`
    lifts the front and drops the back (a hairline), `jag` pushes every other point out (fur, fluff)."""
    return (y, rx, rx if rz is None else rz, cx, cz, tilt, jag)


def loft(name, mat, rings, seg=8, p=2.0, rot=None, caps=True, closed=False, m=None, smooth=False):
    """Rings stacked along y, each a superellipse (p = 2 round, higher is boxier), skinned into one solid. A ring
    with zero radii is a point (a pole). `closed` joins the last ring back to the first (a lathed brim)."""
    bm = bmesh.new()
    rot = math.pi / seg if rot is None else rot  # a face, not an edge, looks forward
    base = []
    for j in range(seg):
        a = rot + 2 * math.pi * j / seg
        c, s = math.cos(a), math.sin(a)
        base.append((math.copysign(abs(c) ** (2 / p), c), math.copysign(abs(s) ** (2 / p), s)))
    rows = []
    for y, rx, rz, cx, cz, tilt, jag in rings:
        if rx == 0 and rz == 0:
            rows.append([bm.verts.new((cx, y, cz))])
            continue
        row = []
        for j, (ux, uz) in enumerate(base):
            k = 1 + jag if j % 2 else 1
            row.append(bm.verts.new((cx + ux * rx * k, y + tilt * uz, cz + uz * rz * k)))
        rows.append(row)
    n = len(rows)
    for i in range(n if closed else n - 1):
        a, b = rows[i], rows[(i + 1) % n]
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(seg):
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[(j + 1) % seg]))
            elif len(b) == 1:
                bm.faces.new((a[j], a[(j + 1) % seg], b[0]))
            else:
                bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    if caps and not closed:
        for row in (rows[0], rows[-1]):
            if len(row) > 2:
                bm.faces.new(row)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if m is not None:
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    for f in bm.faces:
        f.smooth = smooth
    return obj(name, bm, [mat])


def ball(name, mat, r, at, scale=(1, 1, 1), seg=8, rings=5, jag=0.0, smooth=False):
    """A low-poly sphere (a loft from pole to pole), squashed by `scale`, centred at `at`."""
    sx, sy, sz = scale
    rs = [R(-r * sy, 0, 0)]
    for i in range(1, rings):
        t = math.pi * i / rings
        rs.append(R(-math.cos(t) * r * sy, math.sin(t) * r * sx, math.sin(t) * r * sz, jag=jag))
    rs.append(R(r * sy, 0, 0))
    return loft(name, mat, rs, seg=seg, m=Matrix.Translation(at), smooth=smooth)


def box(name, mat, size, at, bevel=0.0, rot=(0, 0, 0)):
    """A box with chamfered edges, turned by `rot` (radians about x, y, z) about its centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Diagonal((*size, 1)))
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel, segments=1, affect="EDGES", profile=0.5)
    turn = Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[2], 4, "Z")
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ turn, verts=bm.verts)
    return obj(name, bm, [mat])


def along(axis, at):
    """Turns a loft built along y to run along `axis` ("x" or "z"), centred at `at`."""
    turn = Matrix.Rotation(-math.pi / 2, 4, "Z") if axis == "x" else Matrix.Rotation(math.pi / 2, 4, "X")
    return Matrix.Translation(at) @ turn


def join(parts, name):
    """One object from many, turned from the game's frame into Blender's (the glTF writer turns it back)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    o.data.transform(GAME_TO_BLENDER)
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def write_glb(objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="EXPORT", export_texcoords=False)
    print(f"{sum(tris(o) for o in objs)} triangles in {len(objs)} parts -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")


def stage(ground="#7c8f55", sky=(0.78, 0.8, 0.74)):
    """A patch of meadow, a low warm sun and a sky-coloured world, for preview stills."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*sky, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.color = (1.0, 0.95, 0.85)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    PALETTE["ground"] = (*hexrgb(ground), 1.0, 0)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12)
    obj("ground", bm, ["ground"])
    scene.view_settings.view_transform = "Standard"


def render(path, views, target=(0, 0, 0.9), size=(1200, 800), lens=50):
    """Preview stills, one per (suffix, camera position) in Blender's frame."""
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = lens
    scene.collection.objects.link(cam)
    scene.camera = cam
    stem, ext = os.path.splitext(path)
    for suffix, where, *aim in views:
        cam.location = where
        cam.rotation_euler = (Vector(aim[0] if aim else target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = stem + suffix + ext
        bpy.ops.render.render(write_still=True)


def args():
    """What follows `--` on Blender's command line."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
