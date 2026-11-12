# Close-ups of any beast GLB, one PNG strip: front, side, three-quarter and the head, each through an orthographic
# camera. Given several GLBs (git main's build and the working tree's), every strip uses the largest one's framing, so
# they line up tile for tile and a change in size shows.
# `blender -b --factory-startup --python-exit-code 1 -P blender/closeups.py -- <in.glb> <out.png> [<in.glb> <out.png> ...] [--tile px]`
# (scripts/beast-refs.ts --closeups runs it). It reads only the GLB, so it draws what the game loads (a baked hide included), not beast.py's full mesh.
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


def head_box(p):
    """The head's corner points: the top quarter of an upright beast, the front third of one on all fours (beasts face +X)."""
    lo, hi = p.min(0), p.max(0)
    length, height = hi[0] - lo[0], hi[2] - lo[2]
    if height > length * 1.1:
        near = p[p[:, 2] > hi[2] - 0.28 * height]
    else:  # the front third reaches the ground (forelegs, a long neck's base): the head is its top part
        near = p[p[:, 0] > hi[0] - 0.32 * length]
        top = near[:, 2].max()
        near = near[near[:, 2] > top - 0.4 * (top - lo[2])]
    return near.min(0), near.max(0)


def shoot(scene, cam, centre, scale, direction, path):
    d = Vector(direction).normalized()
    cam.data.ortho_scale = scale
    cam.location = Vector(centre) + d * (scale * 4 + 10)
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def strip(paths, out, tile):
    """The four renders side by side in one PNG."""
    rows = []
    for p in paths:
        im = bpy.data.images.load(p)
        rows.append(np.array(im.pixels[:]).reshape(tile, tile, 4))
        bpy.data.images.remove(im)
    px = np.concatenate(rows, axis=1)
    img = bpy.data.images.new("strip", tile * len(paths), tile)
    img.pixels = px.ravel().tolist()
    img.filepath_raw, img.file_format = out, "PNG"
    img.save()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    tile = int(argv[argv.index("--tile") + 1]) if "--tile" in argv else 600
    if "--tile" in argv:
        del argv[argv.index("--tile"):argv.index("--tile") + 2]
    if len(argv) < 2 or len(argv) % 2:
        raise SystemExit("usage: blender -b -P blender/closeups.py -- <in.glb> <out.png> [<in.glb> <out.png> ...] [--tile px]")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    builds = []  # (out, meshes, points), one per GLB, all in the scene at the origin and drawn one at a time
    for glb, out in zip(argv[0::2], argv[1::2]):
        had = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=glb)
        meshes = [o for o in bpy.context.scene.objects if o not in had and o.type == "MESH"]
        if not meshes:
            raise SystemExit(f"no mesh in {glb}")
        builds.append((out, meshes, verts(meshes)))
    scene, cam = setup(tile)
    every = np.concatenate([p for _, _, p in builds])
    lo, hi = every.min(0), every.max(0)
    mid, scale = (lo + hi) / 2, float(max(hi - lo)) * 1.15
    hlo, hhi = head_box(every)
    hmid, hsize = (hlo + hhi) / 2, float(max(hhi - hlo)) * 1.3
    shots = (
        (mid, scale, (1, 0, 0.12)),                       # front: facing you
        (mid, scale, (0, -1, 0.05)),                      # side: the profile, head to the right
        (mid, scale, (0.75, -1, 0.4)),                    # three-quarter, from a little above
        (hmid, hsize, (0.9, -0.7, 0.25)),                 # the head, filling the frame
    )
    for out, meshes, _ in builds:
        for o in scene.objects:
            if o.type == "MESH":
                o.hide_render = o not in meshes
        paths = []
        for view, (c, s, d) in zip(VIEWS, shots):
            path = f"{out[:-4]}.{view}.png"
            shoot(scene, cam, c, s, d, path)
            paths.append(path)
        strip(paths, out, tile)
        print(f"closeups -> {out} (ortho {scale:.2f} m)")


main()
