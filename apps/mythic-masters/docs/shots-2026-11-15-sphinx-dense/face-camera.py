import math
import sys

import bpy
import numpy as np
from mathutils import Vector

VIEWS = ("front", "side", "three-quarter", "head")


def setup(tile):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = tile
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"  # no filmic roll-off: colours as three.js draws them
    world = bpy.data.worlds.new("world")
    world.color = (0.62, 0.66, 0.72)
    scene.world = world
    for name, energy, rot in (("key", 4.0, (50, -15, -40)), ("fill", 1.2, (70, 10, 150))):
        sun = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        sun.data.energy = energy
        sun.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.clip_end = 1000
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def verts(objs):
    return np.array([tuple(o.matrix_world @ v.co) for o in objs for v in o.data.vertices])
argv = sys.argv[sys.argv.index("--") + 1:]
glb, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene, cam = setup(600)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in scene.objects if o.type == "MESH"]
V = verts(objs)
x1, top = V[:, 0].max(), V[:, 2].max()
sel = V[(V[:, 0] > x1 - 0.45) & (V[:, 2] > 0.45 * top)]
mid = Vector(((sel.min(0) + sel.max(0)) / 2).tolist())
cam.data.ortho_scale = 0.95
tiles = []
for name, d in (("front", (1, 0, 0)), ("profile", (0, -1, 0)), ("tq", (0.8, -0.6, 0.1))):
    d = Vector(d).normalized()
    cam.location = mid + d * 10
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out}.{name}.png"
    bpy.ops.render.render(write_still=True)
    tiles.append(scene.render.filepath)
print("TILES", *tiles)
