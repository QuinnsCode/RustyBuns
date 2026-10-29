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
    # in sheet order: a set's order follows Python's per-run string hashing, and the skin modifier's hull
    # (so the rigger's feet) follows the edge order
    links = [tuple(l) for l in sheet["links"]]
    links += [(mirrored(a), mirrored(b)) for a, b in links if a.startswith("l_") or b.startswith("l_")]
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
    if sheet.get("blobs"):
        o = blobs(o, sheet["blobs"], nodes)
    return o, nodes


def blobs(o, spec, nodes):
    """Round flesh over the skin: an ellipsoid at a node (radii x, y, z) for a body too short and fat for
    the skin modifier, which boxes the hull where four limbs meet. The rigger fills the volume, so the
    overlap needs no union."""
    out = [o]
    for i, b in enumerate(spec):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1)
        bmesh.ops.scale(bm, vec=Vector(b["r"]), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector(nodes[b["at"]][:3]) + Vector(b.get("off", (0, 0, 0))), verts=bm.verts)
        me = bpy.data.meshes.new(f"blob{i}")
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(o.data.materials[0])
        b = bpy.data.objects.new(f"blob{i}", me)
        bpy.context.collection.objects.link(b)
        out.append(b)
    bpy.ops.object.select_all(action="DESELECT")
    for x in out:
        x.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()
    return o


def two_tone(o, back, belly, turn):
    """The underside in a second colour, blended by how far each point's normal turns down past `turn`
    (-1 straight down, 0 sideways): an animal's back darker than its front. A colour per vertex on the
    body's material, painted after the decimator (a colour attribute steers what it keeps, and Hodag's
    short legs pay); every other material's points stay white so their own colour shows."""
    m = bpy.data.materials[back]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    if not any(n.bl_idname == "ShaderNodeVertexColor" for n in m.node_tree.nodes):
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
        attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "tone"
        m.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    mats = [x.name for x in o.data.materials]
    body = set()
    for p in o.data.polygons:
        if mats[p.material_index] == back:
            body.update(p.vertices)
    col = o.data.color_attributes.new("tone", "FLOAT_COLOR", "POINT")
    a, b = [[linear(c) for c in PALETTE[n][:3]] for n in (back, belly)]
    for v in o.data.vertices:
        if v.index not in body:
            col.data[v.index].color = (1, 1, 1, 1)
            continue
        # the mesh is in Blender's frame by now (z up)
        k = max(0.0, min(1.0, (turn + 0.15 - v.normal.z) / 0.3))
        k = k * k * (3 - 2 * k)
        col.data[v.index].color = (*[x + (y - x) * k for x, y in zip(a, b)], 1)
    o.data.color_attributes.active_color = col


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


def scallop(points, start, depth):
    """A wing's trailing edge cut into scallops: between each pair of points from `start` on (around to
    the first), a point pulled in toward the middle by `depth` of the way, the way a bat's wing hangs
    between its fingers."""
    mid = sum((Vector(p) for p in points), Vector()) / len(points)
    out = []
    for i, p in enumerate(points):
        out.append(p)
        if i >= start:
            a, b = Vector(p), Vector(points[(i + 1) % len(points)])
            m = (a + b) / 2
            out.append(tuple(m.lerp(mid, depth)))
    return out


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
                d = Vector(s(p["dir"]))
                out.append(cone(name, at, d, p["len"], p["base"], p["material"]))
            elif p["kind"] == "eye":
                at = Vector(node(p["at"])) + Vector(s(p["off"]))
                out.append(ball(name, at, p["r"], p["material"]))
            elif p["kind"] == "membrane":
                pts = [node(q) for q in p["points"]]
                if "scallop" in p:
                    pts = scallop(pts, p["scallop"], p.get("scallop_depth", 0.25))
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


def write_glb(o, path, budget, tone=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    lod = o.copy()
    lod.data = o.data.copy()
    bpy.context.collection.objects.link(lod)
    if budget and tris(o) > budget:
        lod.modifiers.new("decimate", "DECIMATE").ratio = budget / tris(o)
        apply_all(lod)
    # the decimator's face order changes run to run: sort by position so one sheet always builds the same GLB
    bm = bmesh.new()
    bm.from_mesh(lod.data)
    for seq, key in ((bm.verts, lambda v: v.co.to_tuple(5)), (bm.faces, lambda f: (f.material_index, f.calc_center_median().to_tuple(5)))):
        rank = {e: i for i, e in enumerate(sorted(seq, key=key))}
        seq.sort(key=lambda e: rank[e])
    bm.to_mesh(lod.data)
    bm.free()
    if tone:
        two_tone(lod, *tone)
    lod.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="EXPORT",
                              export_vertex_color="ACTIVE")
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
    tone = (sheet.get("material", "hide"), sheet["belly"], sheet.get("belly_turn", -0.2)) if "belly" in sheet else None
    write_glb(beast, os.path.join(APP, "public", "models", sheet["id"] + ".glb"), sheet.get("budget", 3000), tone)
    if tone:
        two_tone(beast, *tone)
    if "--render" in argv:
        render(beast, os.path.join(HERE, "out", sheet["id"] + ".png"))


main()
