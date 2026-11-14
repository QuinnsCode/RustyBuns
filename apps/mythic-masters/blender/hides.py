# Every hide pattern on a sphere and on a sample beast, in one PNG, to judge a pattern before a sheet wears it:
# `bun scripts/beasts.ts --swatch [pattern ...]` runs
# `blender -b --factory-startup --python-exit-code 1 -P blender/hides.py -- [--sample <id>] [--out <png>] [pattern ...]`.
# Each cell is baked the way a GLB is (beast.py `low_poly`, `shade`, `bake_hide`: colour, normal and roughness maps)
# and drawn in EEVEE under one sun, so what shows here is what the game's material gets. EXAMPLES is the example hide
# for each pattern (beast.py's header lists the keys); a new pattern adds a row here and shows up on the sheet.
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import beast as B  # noqa: E402  (beast.py builds nothing on import)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

# pattern -> (the body's colour, sRGB, and its hide)
EXAMPLES = {
    "scales": ((0.44, 0.5, 0.22), {"pattern": "scales", "size": 0.035, "colours": [[0.8, 0.8, 0.3], [0.4, 0.42, 0.18]]}),
    "skin": ((0.42, 0.4, 0.36), {"pattern": "skin", "size": 0.12, "colours": [[0.25, 0.22, 0.2]]}),
    "fur": ((0.46, 0.33, 0.22), {"pattern": "fur", "size": 0.01, "colours": [[0.28, 0.2, 0.14], [0.62, 0.48, 0.34]],
                               "band": {"colour": [0.2, 0.14, 0.1], "width": 0.18}}),
    "spots": ((0.78, 0.6, 0.34), {"pattern": "spots", "size": 0.06, "colours": [[0.22, 0.16, 0.1]]}),
    "feathers": ((0.36, 0.3, 0.26), {"pattern": "feathers", "size": 0.1, "colours": [[0.16, 0.13, 0.12], [0.4, 0.34, 0.28]]}),
    "bark": ((0.36, 0.28, 0.2), {"pattern": "bark", "size": 0.09, "colours": [[0.12, 0.09, 0.07], [0.4, 0.32, 0.24]],
                                 "moss": {"colour": [0.3, 0.42, 0.16], "cover": 0.45}}),
    "shell": ((0.4, 0.36, 0.24), {"pattern": "shell", "size": 0.14, "colours": [[0.26, 0.22, 0.14], [0.56, 0.5, 0.32]]}),
    "wet": ((0.32, 0.42, 0.26), {"pattern": "wet", "size": 0.05, "colours": [[0.2, 0.26, 0.14], [0.46, 0.5, 0.3]]}),
    "velvet": ((0.5, 0.38, 0.3), {"pattern": "velvet", "size": 0.08, "colours": [[0.42, 0.31, 0.25]]}),
}
COLS, CELL, BALL = 3, (4.6, 2.3), 0.9  # cells per row, a cell's size in metres (a sphere and the beast beside it), the sphere's radius


def label(text, at):
    t = bpy.data.objects.new("label-" + text, bpy.data.curves.new(text, "FONT"))
    t.data.body, t.data.size = text, 0.26
    t.location, t.rotation_euler = at, (math.pi / 2, 0, 0)
    t.data.materials.append(B.material("label"))
    bpy.context.collection.objects.link(t)


def wear(o, pattern, slot=0, segs=None):
    """`o` (a sphere, or a low-poly copy of the sample beast) baked in `pattern`'s example hide, on a material of its
    own in `slot` (bake_hide wires its maps into the material, so two meshes sharing one would show one map)."""
    name = f"swatch-{pattern}-{o.name}"
    B.PALETTE[name] = (*EXAMPLES[pattern][0], 0.8, 0)
    if slot < len(o.data.materials):
        o.data.materials[slot] = B.material(name)
    else:
        o.data.materials.append(B.material(name))
    lift = B.shade(o, name, lift=B.HIDE_LIFT)
    B.bake_hide(o, EXAMPLES[pattern][1], name, lift, segs)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d  # noqa: E731
    sample, out = opt("--sample", "tatzelwurm"), opt("--out", os.path.join(B.HERE, "out", "hides.png"))
    flags = {x for i, x in enumerate(argv) if x.startswith("--") or (i and argv[i - 1] in ("--sample", "--out"))}
    pats = [x for x in argv if x not in flags] or list(EXAMPLES)
    for p in pats:
        if p not in EXAMPLES:
            raise SystemExit(f"no example for {p!r}: {', '.join(EXAMPLES)}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(os.path.join(B.APP, "beasts", sample + ".json")) as f:
        sheet = json.load(f)
    B.PALETTE.update(sheet["palette"])
    B.PALETTE["label"] = (0.1, 0.1, 0.12, 0.9, 0)
    bod, nodes, links = B.body(sheet)
    segs = B.chains(sheet, nodes, links)
    beast = B.join([bod, *B.parts(sheet, nodes)], sheet["id"], sheet)
    lo, hi = [Vector(c) for c in (beast.bound_box[0], beast.bound_box[6])]
    k = 2.5 / max(hi.x - lo.x, 1e-3)  # every sample beast drawn 2.5 m long, so the cells line up
    back = sheet.get("material", "hide")
    slot = [m.name for m in beast.data.materials].index(back)
    rows = math.ceil(len(pats) / COLS)
    # the sample (and each low-poly copy as it bakes) stands well off the sheet: a sphere's baked occlusion would hit it
    beast.location = (0, 60, 0)
    for i, p in enumerate(pats):
        cx, cz = (i % COLS) * CELL[0], -(i // COLS) * CELL[1]
        bpy.ops.mesh.primitive_uv_sphere_add(radius=BALL, segments=64, ring_count=32, location=(cx + BALL, 0, cz + BALL))
        ball = bpy.context.active_object
        ball.name = "ball-" + p
        ball.data.uv_layers.remove(ball.data.uv_layers[0])  # its own UVs would be the ones the map is read through
        bpy.ops.object.shade_smooth()
        wear(ball, p)
        body = B.low_poly(beast, sheet.get("budget", 3000))
        body.name = f"{sheet['id']}-{p}"
        wear(body, p, slot, segs)
        body.scale = (k, k, k)
        body.location = (cx + 2 * BALL + 0.1 - lo.x * k, 0, cz - lo.z * k + 0.05)
        label(p, (cx + 2 * BALL + 0.15, -2.0, cz + 1.75))
    beast.hide_render = True
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 2760
    scene.render.resolution_y = int(2760 * rows * CELL[1] / (COLS * CELL[0]))
    scene.view_settings.view_transform = "Standard"
    scene.world = bpy.data.worlds.new("world")
    scene.world.color = (0.62, 0.66, 0.72)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(-40))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("swatch", bpy.data.cameras.new("swatch"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type, cam.data.ortho_scale = "ORTHO", COLS * CELL[0]
    cam.location = (COLS * CELL[0] / 2 - 0.1, -20, -(rows - 1) * CELL[1] / 2 + 0.95)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f"render -> {os.path.relpath(out)}")


main()
