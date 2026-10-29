# A beast from its sheet: `blender -b --factory-startup -P blender/beast.py -- beasts/<id>.json [--render]`.
# The sheet is a stick figure (nodes with a radius, links between them) that Blender's skin modifier
# wraps in flesh, plus parts (spikes, horns, eyes, wing membranes) laid on it. Out: public/models/<id>.glb
# at the sheet's triangle budget, and with --render a contact sheet (profile, front, three-quarter) in
# blender/out/<id>.png to judge it by eye. Sheets are in the game's frame: y up, facing +x, left = +z, metres.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
PALETTE = {}  # name -> (r, g, b, roughness, metalness[, glow]), colours in sRGB like a hex code


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    r, g, b, rough, metal, *glow = PALETTE[name]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (linear(r), linear(g), linear(b), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if glow:
        bsdf.inputs["Emission Color"].default_value = (linear(r), linear(g), linear(b), 1)
        bsdf.inputs["Emission Strength"].default_value = glow[0]
    return m


def obj(name, me, mat):
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material(mat))
    return o


def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def mirrored(name):
    return "r_" + name[2:] if name.startswith("l_") else name


def flip(v):
    return (v[0], v[1], -v[2])


# --- the body: a stick figure the skin modifier wraps ---------------------------------------------------

def body(sheet):
    nodes = dict(sheet["nodes"])
    for k, v in list(nodes.items()):
        if k.startswith("l_"):
            nodes[mirrored(k)] = [v[0], v[1], -v[2], v[3]]
    links = set()
    for a, b in sheet["links"]:
        links.add((a, b))
        if a.startswith("l_") or b.startswith("l_"):
            links.add((mirrored(a), mirrored(b)))
    names = list(nodes)
    me = bpy.data.meshes.new("body")
    me.from_pydata([tuple(nodes[n][:3]) for n in names], [(names.index(a), names.index(b)) for a, b in links], [])
    o = obj("body", me, sheet.get("material", "hide"))
    bpy.context.view_layer.objects.active = o
    skin = o.modifiers.new("skin", "SKIN")
    skin.branch_smoothing = sheet.get("branch_smoothing", 0.5)
    for i, n in enumerate(names):
        r = nodes[n][3]
        o.data.skin_vertices[0].data[i].radius = (r, r)
    o.data.skin_vertices[0].data[names.index(sheet["root"])].use_root = True
    o.modifiers.new("subsurf", "SUBSURF").levels = sheet.get("subsurf", 2)
    # the skin modifier leaves a boxy hull where limbs meet; a light pass on the dense mesh rounds it off
    # without shrinking the limbs (a heavy one eats them: the rigger then loses the feet)
    factor, passes = sheet.get("smooth", [0.3, 3])
    smooth = o.modifiers.new("smooth", "SMOOTH")
    smooth.factor, smooth.iterations = factor, passes
    apply_all(o)
    bpy.ops.object.shade_smooth()
    return o, nodes


# --- parts laid on the body ----------------------------------------------------------------------------

def cone(name, at, direction, length, base, mat, segments=6):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, radius1=base, radius2=0.0, depth=length, segments=segments)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = obj(name, me, mat)
    d = Vector(direction).normalized()
    o.matrix_world = Matrix.Translation(Vector(at) + d * (length / 2)) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    return o


def ball(name, at, r, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = obj(name, me, mat)
    o.location = at
    return o


def sheet_face(name, points, thick, mat):
    """A membrane: one face through the points, given a little thickness."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in points], [], [list(range(len(points)))])
    o = obj(name, me, mat)
    o.modifiers.new("solidify", "SOLIDIFY").thickness = thick
    apply_all(o)
    return o


def along(nodes, chain, n):
    """n points evenly spaced along the chain's polyline, each (position, radius, forward tangent)."""
    pts = [Vector(nodes[c][:3]) for c in chain]
    rs = [nodes[c][3] for c in chain]
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)
    out = []
    for k in range(n):
        d = total * (k + 0.5) / n
        i = 0
        while i < len(seg) - 1 and d > seg[i]:
            d -= seg[i]
            i += 1
        t = d / seg[i] if seg[i] else 0
        out.append((pts[i].lerp(pts[i + 1], t), rs[i] + (rs[i + 1] - rs[i]) * t, (pts[i + 1] - pts[i]).normalized()))
    return out


def resolve(nodes, p):
    return Vector(nodes[p][:3]) if isinstance(p, str) else Vector(p)


def parts(sheet, nodes):
    out = []
    for i, p in enumerate(sheet.get("parts", [])):
        for side in ([1, -1] if p.get("mirror") else [1]):
            s = lambda v: (v[0], v[1], v[2] * side)
            # a node name on the mirrored side is its r_ twin (already flipped); plain coordinates flip
            node = lambda k: tuple(nodes[mirrored(k) if side < 0 else k][:3]) if isinstance(k, str) else s(k)
            name = f"{p['kind']}{i}{'r' if side < 0 else ''}"
            if p["kind"] == "spikes":
                for j, (at, r, fwd) in enumerate(along(nodes, p["along"], p["n"])):
                    top = at + Vector((0, r * p.get("sink", 0.85), 0))
                    d = Vector((p.get("lean", -0.3), 1, 0))
                    out.append(cone(f"{name}_{j}", top, d, p["len"], p["base"], p["material"]))
            elif p["kind"] == "horn":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                d = Vector(s(p["dir"])).normalized()
                out.append(cone(name, at, d, p["len"], p["base"], p["material"]))
                # tines branch off the beam: [how far up it (0-1), direction, length], an antler not a spike
                for j, (t, td, tl) in enumerate(p.get("tines", [])):
                    root = at + d * (p["len"] * t)
                    out.append(cone(f"{name}_t{j}", root, s(td), tl, p["base"] * (1 - t) * 0.9, p["material"]))
            elif p["kind"] == "eye":
                at = Vector(node(p["at"])) + Vector(s(p["off"]))
                out.append(ball(name, at, p["r"], p["material"]))
            elif p["kind"] == "membrane":
                pts = [node(q) for q in p["points"]]
                out.append(sheet_face(name, pts, p.get("thick", 0.02), p["material"]))
            else:
                raise ValueError(f"unknown part kind {p['kind']}")
    return out


# --- out: one object, a GLB at the budget, a contact sheet ----------------------------------------------

def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    # the game's frame (y up, facing +x) into Blender's (z up); the glTF writer turns it back
    o.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def write_glb(o, path, budget):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    lod = o.copy()
    lod.data = o.data.copy()
    bpy.context.collection.objects.link(lod)
    if budget and tris(o) > budget:
        lod.modifiers.new("decimate", "DECIMATE").ratio = budget / tris(o)
        apply_all(lod)
    lod.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="EXPORT")
    print(f"{tris(lod)} triangles -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")
    bpy.data.objects.remove(lod)


def render(o, path):
    """Three of it in a row (profile, facing you, three-quarter) by a 1 m post, in one PNG."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1500, 600
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("world")
    world.color = (0.62, 0.66, 0.72)
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(-40))
    scene.collection.objects.link(sun)
    lo, hi = [Vector(c) for c in (o.bound_box[0], o.bound_box[6])]
    size, height = max(hi - lo), hi.z
    w = max(size, height) * 1.25
    for k, yaw in enumerate((0, -90, -135)):
        c = o.copy()
        scene.collection.objects.link(c)
        c.location = ((k - 1) * w, 0, 0)
        c.rotation_euler = (0, 0, math.radians(yaw))
    o.hide_render = True
    post = bpy.data.objects.new("post", bpy.data.meshes.new("post"))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, radius1=0.015, radius2=0.015, depth=1, segments=6)
    bm.to_mesh(post.data)
    bm.free()
    post.location = (-1.5 * w - 0.2, 0, 0.5)
    scene.collection.objects.link(post)
    ground = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=w * 4)
    bm.to_mesh(ground.data)
    bm.free()
    scene.collection.objects.link(ground)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    d = 4.4 * w
    cam.location = (0, -d, height * 0.5 + d * 0.22)
    cam.rotation_euler = (Vector((0, 0, height * 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"render -> {os.path.relpath(path)}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: blender -b --factory-startup -P blender/beast.py -- beasts/<id>.json [--render]")
    with open(argv[0]) as f:
        sheet = json.load(f)
    PALETTE.update(sheet["palette"])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bod, nodes = body(sheet)
    beast = join([bod, *parts(sheet, nodes)], sheet["id"])
    lo, hi = [Vector(c) for c in (beast.bound_box[0], beast.bound_box[6])]
    print(f"{sheet['id']}: {tris(beast)} triangles, {hi.x - lo.x:.2f} long, {hi.y - lo.y:.2f} wide, {hi.z:.2f} tall")
    write_glb(beast, os.path.join(APP, "public", "models", sheet["id"] + ".glb"), sheet.get("budget", 3000))
    if "--render" in argv:
        render(beast, os.path.join(HERE, "out", sheet["id"] + ".png"))


main()
