# What every model script here shares: materials by name, bmesh to object, modifiers, joining, the turn from
# the game's frame (y up, forward +z) into Blender's (z up, forward -y), GLB output at a triangle budget, and
# preview renders. A script fills PALETTE with its materials and builds in the game's frame.
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models")
# name -> (r, g, b, roughness, metalness), colours in sRGB like a hex code
PALETTE = {}


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    r, g, b, rough, metal = PALETTE[name]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (linear(r), linear(g), linear(b), 1)
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


def join(parts, name, smooth=35):
    """One object from many, turned from the game's frame into Blender's (the glTF writer turns it back)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    o.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    if smooth:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth))
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def write_glb(o, path, target=None):
    """Write `o` as a GLB, decimated to about `target` triangles first if it has more."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    lod = o.copy()
    lod.data = o.data.copy()
    bpy.context.collection.objects.link(lod)
    if target and tris(o) > target:
        modify(lod, "DECIMATE", ratio=target / tris(o), use_collapse_triangulate=True)
        apply_all(lod)
    lod.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="EXPORT")
    print(f"{tris(lod)} triangles -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")
    bpy.data.objects.remove(lod)


def render(path, views, target=(0, 0, 0.4), size=(1200, 700)):
    """Preview stills, one per (suffix, camera position) in Blender's frame, to judge a model by eye."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = size
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
    for suffix, where in views:
        cam.location = where
        cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = stem + suffix + ext
        bpy.ops.render.render(write_still=True)


def args():
    """What follows `--` on Blender's command line."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
