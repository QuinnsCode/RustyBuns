# A lineup of beast GLBs in one picture: one three-quarter orthographic camera, the close-ups' light (blender/closeups.py),
# every beast at its true size, side by side left to right in the order given, its name under it.
# `blender -b --factory-startup --python-exit-code 1 -P proposals/house/lineup.py -- <out.png> <px> <in.glb> <name> [<in.glb> <name> ...]`
# (proposals/house/lineup.ts runs it). It reads only the GLBs, so it draws what the game loads.
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "blender"))
from closeups import setup, verts  # noqa: E402  the same world colour, key and fill suns, and ortho camera

VIEW = Vector((0.75, -1, 0.4)).normalized()  # closeups.py's three-quarter: from the beast's front left, a little above
GAP = 0.25  # metres of air between two beasts, at least; more for big ones (a share of the bigger's width)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out, px, rest = argv[0], int(argv[1]), argv[2:]
    if len(rest) < 2 or len(rest) % 2:
        raise SystemExit("usage: lineup.py -- <out.png> <px> <in.glb> <name> [<in.glb> <name> ...]")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene, cam = setup(px)
    look = -VIEW
    right = look.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(look).normalized()
    at, placed, lo_all, hi_all = 0.0, [], None, None
    for glb, name in zip(rest[0::2], rest[1::2]):
        had = set(scene.objects)
        bpy.ops.import_scene.gltf(filepath=glb)
        new = [o for o in scene.objects if o not in had]
        meshes = [o for o in new if o.type == "MESH"]
        if not meshes:
            raise SystemExit(f"no mesh in {glb}")
        p = verts(meshes)
        across = p @ np.array(right)
        width = float(across.max() - across.min())
        gap = GAP + 0.15 * width if placed else 0.0
        # slide the beast along the screen's right so its left edge sits `gap` past the last one's right edge
        shift = at + gap - float(across.min())
        for o in new:
            if o.parent is None:
                o.location += right * shift
        bpy.context.view_layer.update()
        p = verts(meshes)
        at = float((p @ np.array(right)).max())
        placed.append((name, p))
        lo_all = p.min(0) if lo_all is None else np.minimum(lo_all, p.min(0))
        hi_all = p.max(0) if hi_all is None else np.maximum(hi_all, p.max(0))
    every = np.concatenate([p for _, p in placed])
    sx, sy = every @ np.array(right), every @ np.array(up)
    # the names' letter height: small beside the whole row, and never wider than the narrowest beast's slot
    slots = [float((p @ np.array(right)).max() - (p @ np.array(right)).min()) + GAP for _, p in placed]
    label = min(0.022 * float(sx.max() - sx.min()), min(s / max(len(n), 4) * 1.7 for s, (n, _) in zip(slots, placed)))
    white = bpy.data.materials.new("label")
    white.use_nodes = True
    em = white.node_tree.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.95, 0.95, 0.95, 1)
    white.node_tree.links.new(em.outputs[0], white.node_tree.nodes["Material Output"].inputs["Surface"])
    floor = float(sy.min())
    for name, p in placed:
        cx = float(((p @ np.array(right)).max() + (p @ np.array(right)).min()) / 2)
        mid = Vector(p.mean(0))
        base = mid + right * (cx - mid.dot(right)) + up * (floor - mid.dot(up) - label * 1.4)
        cu = bpy.data.curves.new(f"label_{name}", "FONT")
        cu.body, cu.align_x, cu.align_y, cu.size = name, "CENTER", "TOP", label
        t = bpy.data.objects.new(f"label_{name}", cu)
        t.data.materials.append(white)
        t.location = base
        t.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(t)
    width, height = float(sx.max() - sx.min()), float(sy.max() - sy.min()) + label * 3
    centre_s = Vector(every.mean(0))
    centre = centre_s + right * ((sx.max() + sx.min()) / 2 - centre_s.dot(right)) + up * ((sy.max() + floor - label * 3) / 2 - centre_s.dot(up))
    aspect = max(0.25, min(1.0, height / width))
    scene.render.resolution_x, scene.render.resolution_y = px, int(px * aspect)
    scale = max(width, height / aspect) * 1.06
    cam.data.ortho_scale = scale
    cam.location = centre + VIEW * (scale * 4 + 10)
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f"lineup -> {out} ({len(placed)} beasts, ortho {scale:.2f} m)")


main()
