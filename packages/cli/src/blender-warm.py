# A warm headless Blender that takes named calls, one JSON line each on stdin, and answers each on stdout as one
# line `@@warm {"id": n, "ok": true, "value": ...}` (or `"ok": false, "error": "..."`). Blender's own chatter goes
# to stdout too, so a reply is the line with that mark; everything else is log. It never runs Python it is sent:
# a call is a name from CALLS with JSON arguments. Stdin closing (the caller exited, its ssh dropped) ends it, so it
# can't outlive the session that started it. Started by `warmBlender` in blender.ts, which sends this file as the
# first line (so a builder Mac needs nothing but Blender), then the calls.
#
#   load {glb, bytes?}          import a GLB (a path under the root, or its bytes in base64) into an empty scene
#   stats {part?}               per mesh, and per material within it: verts, faces, triangles, size; `part` picks one
#   render {view?, size?, part?} a PNG (base64) from front/back/left/right/top/three-quarter, or {yaw, pitch} degrees
#   build {script, args?, env?} run a .py file under the root as a fresh cold run would (`-P script -- args`)
#   ping {}                     the Blender version and this process's resident memory, in MB
import base64
import json
import math
import os
import resource
import runpy
import shutil
import sys
import tempfile
import traceback

import bpy
from mathutils import Vector

ROOT = os.path.realpath(os.environ.get("WARM_ROOT") or os.getcwd())
SCRATCH = tempfile.mkdtemp(prefix="warm-blender-")
MARK = "@@warm "


def inside(path):
    """A path under ROOT, or an error: no call reads or runs anything outside the checkout it was started in."""
    full = os.path.realpath(os.path.join(ROOT, path))
    if full != ROOT and not full.startswith(ROOT + os.sep):
        raise ValueError(f"{path} is outside {ROOT}")
    return full


def meshes():
    return sorted((o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: o.name)


def size_of(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    if not pts:
        return None
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def load(glb, bytes=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if bytes is not None:
        path = os.path.join(SCRATCH, os.path.basename(glb) or "model.glb")
        with open(path, "wb") as f:
            f.write(base64.b64decode(bytes))
    else:
        path = inside(glb)
    bpy.ops.import_scene.gltf(filepath=path)
    return {"glb": glb, "objects": [o.name for o in bpy.context.scene.objects], "meshes": [o.name for o in meshes()]}


def tris(polys):
    return sum(len(p.vertices) - 2 for p in polys)


def stats(part=None):
    """Each mesh, and each material on it: a `part` names a mesh or a material (a beast is one mesh, its parts materials)."""
    rows = []
    for o in meshes():
        m = o.data
        mats = [s.material.name if s.material else "" for s in o.material_slots]
        by = {}
        for p in m.polygons:
            by.setdefault(mats[p.material_index] if p.material_index < len(mats) else "", []).append(p)
        lo, hi = size_of([o])
        row = {"mesh": o.name, "verts": len(m.vertices), "faces": len(m.polygons), "triangles": tris(m.polygons),
               "size": [round(v, 4) for v in hi - lo],
               "materials": [{"material": k, "faces": len(v), "triangles": tris(v)} for k, v in sorted(by.items())]}
        if part is None or part == o.name:
            rows.append(row)
        elif any(r["material"] == part for r in row["materials"]):
            rows.append({**row, "materials": [r for r in row["materials"] if r["material"] == part]})
    if part is not None and not rows:
        names = sorted({o.name for o in meshes()} | {s.material.name for o in meshes() for s in o.material_slots if s.material})
        raise ValueError(f"no mesh or material called {part}: there are {', '.join(names) or 'none (load a GLB first)'}")
    return rows


# Degrees round the model (yaw, from its front, +x in Blender for a beast: the game's y-up +x-facing frame is
# z-up +x after the glTF import, its left -y) and above it (pitch).
VIEWS = {"front": (0, 5), "back": (180, 5), "left": (-90, 5), "right": (90, 5), "top": (0, 85), "three-quarter": (40, 20)}


def render(view="three-quarter", size=512, part=None):
    if isinstance(view, str) and view not in VIEWS:
        raise ValueError(f"view is one of {', '.join(VIEWS)} or {{yaw, pitch}}")
    yaw, pitch = VIEWS[view] if isinstance(view, str) else (float(view["yaw"]), float(view["pitch"]))
    size = max(64, min(int(size), 2048))
    objs = [o for o in meshes() if part is None or o.name == part]
    if not objs:
        raise ValueError("nothing to render: load a GLB first" if part is None else f"no mesh called {part}")
    scene = bpy.context.scene
    for o in meshes():
        o.hide_render = o not in objs
    for o in [o for o in scene.objects if o.name.startswith("warm.")]:
        bpy.data.objects.remove(o)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    # a beast's colours are on its vertices; a baked hide is a texture
    scene.display.shading.color_type = "VERTEX" if any(o.data.color_attributes for o in objs) else "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    if not scene.world:
        scene.world = bpy.data.worlds.new("warm.world")
    scene.world.color = (0.62, 0.66, 0.72)
    lo, hi = size_of(objs)
    mid, d = (lo + hi) / 2, max(hi - lo) * 2.2
    cam = bpy.data.objects.new("warm.camera", bpy.data.cameras.new("warm.camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = mid + Vector((math.cos(y) * math.cos(p), math.sin(y) * math.cos(p), math.sin(p))) * d
    cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
    path = os.path.join(SCRATCH, "render.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    with open(path, "rb") as f:
        return {"view": view, "size": size, "png": base64.b64encode(f.read()).decode()}


def build(script, args=None, env=None):
    """The script as `blender -b --factory-startup -P script -- args` would run it: a fresh module every time (its
    defaults and globals read again, `env` set first), from a factory-empty scene, in the root."""
    path = inside(script)
    if not path.endswith(".py"):
        raise ValueError("build runs a .py file")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    saved_argv, saved_env, saved_path = sys.argv, dict(os.environ), list(sys.path)
    sys.argv = [bpy.app.binary_path, "-b", "-P", path, "--", *(args or [])]
    os.environ.update({k: str(v) for k, v in (env or {}).items()})
    sys.path.insert(0, os.path.dirname(path))
    try:
        runpy.run_path(path, run_name="__main__")
    finally:
        sys.argv = saved_argv
        os.environ.clear()
        os.environ.update(saved_env)
        sys.path[:] = saved_path
        # a sibling the script imported (hides.py imports beast.py) is read again next time, as a cold run would
        here = os.path.dirname(path)
        for name, mod in list(sys.modules.items()):
            file = getattr(mod, "__file__", None)
            if file and os.path.dirname(os.path.realpath(file)) == here:
                del sys.modules[name]
    return {"script": script}


def ping():
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak = rss / (1 << 20) if sys.platform == "darwin" else rss / 1024  # bytes on macOS, KB on Linux
    return {"blender": bpy.app.version_string, "peak_mb": round(peak), "pid": os.getpid(), "root": ROOT}


CALLS = {"load": load, "stats": stats, "render": render, "build": build, "ping": ping}


def reply(msg):
    sys.stdout.write(MARK + json.dumps(msg) + "\n")
    sys.stdout.flush()


def serve():
    os.chdir(ROOT)
    reply({"id": 0, "ok": True, "value": ping()})
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            job = {}
            try:
                job = json.loads(line)
                fn = CALLS.get(job.get("call"))
                if fn is None:
                    raise ValueError(f"no call {job.get('call')!r}: the calls are {', '.join(CALLS)}")
                reply({"id": job.get("id"), "ok": True, "value": fn(**(job.get("args") or {}))})
            except Exception as e:  # one bad call answers with its error; the next call still runs
                sys.stderr.write(traceback.format_exc())
                reply({"id": job.get("id") if isinstance(job, dict) else None, "ok": False, "error": f"{type(e).__name__}: {e}"})
            except SystemExit as e:  # a build script's own `raise SystemExit("usage ...")`
                reply({"id": job.get("id"), "ok": False, "error": f"exit: {e}"})
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)


serve()
