# A beast from its sheet: `blender -b --factory-startup -P blender/beast.py -- beasts/<id>.json [--render]`.
# The sheet is a stick figure (nodes with a radius, links between them) that Blender's skin modifier
# wraps in flesh, plus parts (spikes, horns, eyes, wing membranes) laid on it. Out: public/models/<id>.glb
# at the sheet's triangle budget, and with --render a contact sheet (profile, front, three-quarter) in
# blender/out/<id>.png to judge it by eye. Sheets are in the game's frame: y up, facing +x, left = +z, metres.
#
# Every field below is optional; a sheet without it builds exactly as before.
#   sheet   ends: 1          a cap node past every chain end, so a muzzle, fist or tail tip reaches its radius
#           bridge: true     a halfway node on each link between two fat nodes at a branch (a torn trunk)
#           offset, scale    [x, y, z] metres and a number (or [x, y, z]) for the whole beast, parts and all
#           wings: n         how many wings the rig keeps (scripts/beasts.ts checks it like `feet`)
#           blend: 0.03      blobs and body rebuilt as one seamless skin from voxels this size
#           paint            [{nodes: [...], material}]: those nodes' flesh in another material
#           stripes          {along: [...], n, width: 0.5, material, below: -0.3}: bands across a chain's back
#   blob    material, rot    its own material; [x, y, z] degrees of tilt (a shell, a brow)
#   horn    curve, bend      degrees it bends along its length, toward the `bend` direction (default up)
#           tip_base, flat   radius at its far end (> base: a club), section squashed to `flat` of its width
#   spikes  rows, spread     `rows` per point fanned `spread` degrees around the chain; `sweep` toward its
#           sweep, tilt      end, `tilt` out to the side (side rows on a shell, a crest off the centreline)
#   tuft    along, n, len, base, and rows, spread, sweep (1.5), curve (30), flat (0.3), sink (0.8),
#           material (the body's): flat, curling fur along a chain, swept toward its last node. A tuft or
#           spike roots `sink` of the way out to the skin, a blob's where one covers the chain
#   membrane camber, puff    the middle lifted `camber` metres (up, or outward for a fin) and thickened to
#                            `puff`, tapering to `thick` at the rim: a cupped wing, a flipper
#           feathers         {from, to, n, len, base, curve, flat, tip, material}: a row of flat feathers out
#                            past the rim between two outline points, each a vane rounding off to a blunt
#                            tip `tip` (0.4) of its width; scallop_depth < 0 points outward
#   scales  along, n, len,   overlapping flat plates along a chain, fanned like a tuft (`rows`, `spread`); each
#           base, overlap    is `len` long and `base` wide and lies `overlap` (0.5) flatter toward the chain's end
#   teeth   along, n, len,   small cones fanned along a muzzle chain's lip, hanging from the upper lip and,
#           base, gap,       with `lower`, rising from the lower; `gap` (0.6) is how far the lips sit from the
#           lower, side      chain's centre in its radius, `side` (0.7) how far out to the side the rows run
#   ear     at, off, dir,    a flat, cupped leaf from a node: `len` long, `width` wide, `tilt` degrees out to the
#           len, width,      side, `cup` degrees curled forward (mirror it for the pair)
#           tilt, cup
#   ridge   at, off, dir,    a short curved ridge (a brow above an eye, a lip along a muzzle): `len` long, `base`
#           len, base,       thick, `curve` degrees toward `bend`; lies flat on the skin; its `material` defaults
#           curve, bend      to the body's
#   palette a 6th value is glow strength: the GLB keeps the colour as emissive, strength apart
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
ENDS = (1.1, 0.6)  # how far past a chain end its cap node sits, and how big, in the end's radius
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
    if sheet.get("ends"):
        # the skin modifier caps a chain flat at its last node and the smoothing rounds that cap in, so an
        # end (a muzzle, a fist, a tail tip) comes out about its own radius short; a cap node past each end
        # puts the surface back where the sheet says. `ends` scales how far (1: about the node's radius).
        degree = {}
        for a, b in links:
            degree[a], degree[b] = degree.get(a, 0) + 1, degree.get(b, 0) + 1
        for a, b in list(links):
            for end, other in ((a, b), (b, a)):
                if degree[end] == 1 and end != sheet["root"]:
                    p, q = Vector(nodes[end][:3]), Vector(nodes[other][:3])
                    r = nodes[end][3]
                    tip = p + (p - q).normalized() * (r * sheet["ends"] * ENDS[0])
                    nodes[end + "~cap"] = [*tip, r * ENDS[1]]
                    links.append((end, end + "~cap"))
    if sheet.get("bridge"):
        # the skin modifier's hull can tear where a fat node meets several links (a chest with legs and a
        # neck on it), leaving the trunk in two pieces; a node halfway along each link between two fat nodes
        # (the far one at least half as thick) gives the hull room
        degree = {}
        for a, b in links:
            degree[a], degree[b] = degree.get(a, 0) + 1, degree.get(b, 0) + 1
        split = []
        for a, b in links:
            ra, rb = nodes[a][3], nodes[b][3]
            if max(degree[a], degree[b]) >= 3 and min(ra, rb) >= max(ra, rb) / 2:
                m = f"{a}~{b}"
                nodes[m] = [(x + y) / 2 for x, y in zip(nodes[a], nodes[b])]
                split += [(a, m), (m, b)]
            else:
                split.append((a, b))
        links = split
    o = skinned(sheet, nodes, links)
    if sheet.get("blobs"):
        o = blobs(o, sheet["blobs"], nodes)
        if sheet.get("blend"):
            # one skin over the body and its blobs, no seam: rebuilt from voxels `blend` metres across, then
            # smoothed (every blob takes the body's material)
            o.modifiers.new("remesh", "REMESH").voxel_size = sheet["blend"]
            sm = o.modifiers.new("smooth", "SMOOTH")
            sm.factor, sm.iterations = 0.5, 4
            apply_all(o)
            for f in o.data.polygons:
                f.material_index = 0
                f.use_smooth = True
    if sheet.get("paint") or sheet.get("stripes"):
        paint(o, sheet, nodes, links)
    return o, nodes


def skinned(sheet, nodes, links):
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
    apply_all(o)
    close_holes(o)
    o.modifiers.new("subsurf", "SUBSURF").levels = sheet.get("subsurf", 2)
    # the skin modifier leaves a boxy hull where limbs meet; a light pass on the dense mesh rounds it off
    # without shrinking the limbs (a heavy one eats them: the rigger then loses the feet)
    factor, passes = sheet.get("smooth", [0.3, 3])
    smooth = o.modifiers.new("smooth", "SMOOTH")
    smooth.factor, smooth.iterations = factor, passes
    apply_all(o)
    bpy.ops.object.shade_smooth()
    return o


def close_holes(o):
    """The skin modifier leaves holes where a fat node meets several links (the hull at a hip with a tail
    and two legs on it). Subsurf rounds a hole into a dent, and a voxel remesh (`blend`) floods through it:
    everything past the hole (the tail, the back legs) comes out as outside and vanishes. A face over each
    hole, wound to agree with the face next to it, closes the skin before either runs."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for f in bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)["faces"]:
        for l in f.loops:
            other = [x for x in l.edge.link_faces if x is not f]
            if other:
                if any(m.vert is l.vert for m in other[0].loops if m.edge is l.edge):
                    f.normal_flip()
                break
    bm.to_mesh(o.data)
    bm.free()


def paint(o, sheet, nodes, links):
    """Colour by region. `paint`: each listed node's flesh in a material (a face takes the node it's
    nearest; an `l_` name paints its twin too): legs, a muzzle, a horn or shell grown from body nodes.
    `stripes`: bands across a chain's back in a material, `n` of them, each `width` of its spacing,
    leaving the faces that turn down past `below` (the belly) alone."""
    mats = [m.name for m in o.data.materials]

    def slot(name):
        if name not in mats:
            o.data.materials.append(material(name))
            mats.append(name)
        return mats.index(name)

    owner = {}
    for group in sheet.get("paint", []):
        for k in group["nodes"]:
            owner[k] = owner[mirrored(k)] = slot(group["material"])
    base = lambda k: k.split("~")[0]  # a cap or halfway node belongs to the node it grew from
    segs = [(a, b, Vector(nodes[a][:3]), Vector(nodes[b][:3])) for a, b in links]
    st = sheet.get("stripes")
    if st:
        radii = [nodes[k][3] for k in st["along"]]
        line = [Vector(nodes[k][:3]) for k in st["along"]]
        total = sum((y - x).length for x, y in zip(line, line[1:]))
        stripe = slot(st["material"])
        # cut the flesh square across the chain at every band's edges, so a band ends on a clean line
        # rather than on whichever faces the subdivision happened to leave there
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for i in range(st["n"]):
            for edge in (i, i + st.get("width", 0.5)):
                at, run = edge * total / st["n"], 0.0
                for x, y in zip(line, line[1:]):
                    if run + (y - x).length >= at or y is line[-1]:
                        u = (at - run) / max((y - x).length, 1e-9)
                        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=x.lerp(y, min(u, 1.0)), plane_no=(y - x).normalized())
                        break
                    run += (y - x).length
        bm.to_mesh(o.data)
        bm.free()
    for f in o.data.polygons:
        if f.material_index != 0:
            continue
        c = f.center
        near, best = 1e9, None
        for a, b, pa, pb in segs:
            ab = pb - pa
            t = max(0.0, min(1.0, (c - pa).dot(ab) / max(ab.length_squared, 1e-9)))
            d = (c - pa.lerp(pb, t)).length - (nodes[a][3] + (nodes[b][3] - nodes[a][3]) * t)
            if d < near:
                near, best = d, (a, b, t)
        a, b, t = best
        k = base(a if t < 0.5 else b)
        if k in owner:
            f.material_index = owner[k]
        if st and f.normal.y > st.get("below", -0.3):
            # how far along the chain this face is (the nearest point on its polyline), and whether it's on
            # the chain's flesh at all rather than a leg or neck leaving it
            s, run, near = 0.0, 0.0, 1e9
            for x, y, rx, ry in zip(line, line[1:], radii, radii[1:]):
                xy = y - x
                u = max(0.0, min(1.0, (c - x).dot(xy) / max(xy.length_squared, 1e-9)))
                d = (c - x.lerp(y, u)).length - (rx + (ry - rx) * u)
                if d < near:
                    near, s = d, run + xy.length * u
                run += xy.length
            if near < 0.05 and 0 < s < total and (s / total * st["n"]) % 1 < st.get("width", 0.5):
                f.material_index = stripe


def blobs(o, spec, nodes):
    """Round flesh over the skin: an ellipsoid at a node (radii x, y, z) for a body too short and fat for
    the skin modifier, which boxes the hull where four limbs meet. The rigger fills the volume, so the
    overlap needs no union."""
    out = [o]
    for i, b in enumerate(spec):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1)
        bmesh.ops.scale(bm, vec=Vector(b["r"]), verts=bm.verts)
        if "rot" in b:  # degrees about x, y, z: a tilted shell, a slanted brow
            bmesh.ops.rotate(bm, cent=Vector(), verts=bm.verts, matrix=Euler([math.radians(a) for a in b["rot"]]).to_matrix())
        bmesh.ops.translate(bm, vec=Vector(nodes[b["at"]][:3]) + Vector(b.get("off", (0, 0, 0))), verts=bm.verts)
        me = bpy.data.meshes.new(f"blob{i}")
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(material(b["material"]) if "material" in b else o.data.materials[0])
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


def bend_frame(d, bend):
    """The direction `d` and a unit vector square to it, toward `bend` (default up, or forward when d is
    nearly vertical): the plane a curved part bends in."""
    d = Vector(d).normalized()
    for b in ([Vector(bend)] if bend else []) + [Vector((0, 1, 0)), Vector((1, 0, 0))]:
        b = b - d * b.dot(d)
        if b.length > 1e-3:
            return d, b.normalized()
    return d, Vector((0, 0, 1))


def arc(at, d, b, length, angle, t):
    """The point `t` (0-1) along an arc of `length` leaving `at` along d and turning `angle` radians
    toward b, and the tangent and bend-side normal there."""
    th = angle * t
    if abs(angle) < 1e-6:
        return Vector(at) + d * (length * t), d, b
    r = length / angle
    p = Vector(at) + d * (r * math.sin(th)) + b * (r * (1 - math.cos(th)))
    return p, d * math.cos(th) + b * math.sin(th), -d * math.sin(th) + b * math.cos(th)


def tube(name, at, direction, length, base, tip, mat, curve=0, bend=None, flat=1.0, segments=6, rings=6, profile=None):
    """A cone that curves and tapers: from radius `base` at `at` to `tip` at the far end (0 a point, more
    than base a club), bending `curve` degrees toward `bend` along the way, its section squashed to `flat`
    of its width in the bend direction (a tuft or a feather lies flat on what it bends toward). `profile`
    is instead a list of (how far along, radius in `base`) pairs, a ring at each: a feather's vane."""
    d, b = bend_frame(direction, bend)
    angle = math.radians(curve)
    verts, faces = [], []
    if profile:
        rings, tip = len(profile) - 1, profile[-1][1] * base
    for k in range(rings + 1):
        t, r = (profile[k][0], profile[k][1] * base) if profile else (k / rings, base + (tip - base) * k / rings)
        p, tan, nrm = arc(at, d, b, length, angle, t)
        if k == rings and tip <= 0:
            verts.append(tuple(p))
            break
        side = tan.cross(nrm)
        for j in range(segments):
            a = 2 * math.pi * j / segments
            verts.append(tuple(p + side * (r * math.cos(a)) + nrm * (r * flat * math.sin(a))))
    for k in range(rings):
        s0 = k * segments
        if k == rings - 1 and tip <= 0:
            apex = len(verts) - 1
            faces += [(s0 + j, s0 + (j + 1) % segments, apex) for j in range(segments)]
        else:
            s1 = s0 + segments
            faces += [(s0 + j, s0 + (j + 1) % segments, s1 + (j + 1) % segments, s1 + j) for j in range(segments)]
    faces.append(tuple(reversed(range(segments))))
    if tip > 0:
        faces.append(tuple(range(rings * segments, (rings + 1) * segments)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return obj(name, me, mat)


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


def membrane_normal(points, side):
    """The membrane's facing: up when it lies flat-ish, outward (+z on the left) when it stands up like a
    fin. The same on both sides of a mirrored pair, so a camber bulges the same way on each."""
    n = Vector()
    for i, p in enumerate(points):  # Newell's normal of the outline
        a, b = Vector(p), Vector(points[(i + 1) % len(points)])
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    n.normalize()
    if (n.y if abs(n.y) >= 0.2 else n.z * side) < 0:
        n = -n
    return n


def shell(name, points, rim, p, side, mat):
    """A membrane with volume: the outline filled in rings toward its middle, the middle lifted `camber`
    metres along its facing (a cupped wing, a curved flipper), and with `puff` the middle thickened to that
    many metres, tapering to `thick` at the rim. `feathers` lays a row of flat, slightly curved feathers out
    past the rim between two of the outline's points."""
    c = sum((Vector(q) for q in points), Vector()) / len(points)
    n = membrane_normal(points, side)
    camber = p.get("camber", 0)
    lift = lambda u: n * (camber * (1 - u * u))
    # a feather is a vane, not a spike: narrow at the quill, widest two thirds out, rounding off to a
    # blunt tip `tip` of its width (0: the old point)
    vane = [(0, 0.55), (0.35, 0.9), (0.65, 1.0), (0.88, 0.78), (1, p.get("feathers", {}).get("tip", 0.4))]
    us = (1.0, 2 / 3, 1 / 3)
    verts, faces, weight = [], [], []
    m = len(points)
    for u in us:
        for q in points:
            verts.append(tuple(c + (Vector(q) - c) * u + lift(u)))
            weight.append(1 - u * u)
    verts.append(tuple(c + lift(0)))
    weight.append(1)
    for k in range(len(us) - 1):
        faces += [(k * m + i, k * m + (i + 1) % m, (k + 1) * m + (i + 1) % m, (k + 1) * m + i) for i in range(m)]
    mid, last = len(verts) - 1, (len(us) - 1) * m
    faces += [(last + i, last + (i + 1) % m, mid) for i in range(m)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = obj(name, me, mat)
    thick, puff = p.get("thick", 0.02), p.get("puff", 0)
    solid = o.modifiers.new("solidify", "SOLIDIFY")
    solid.offset = 0
    if puff > thick:
        g = o.vertex_groups.new(name="puff")
        for i, w in enumerate(weight):
            g.add([i], w, "REPLACE")
        solid.vertex_group, solid.thickness, solid.thickness_vertex_group = "puff", puff, thick / puff
    else:
        solid.thickness = thick
    apply_all(o)
    for f in o.data.polygons:
        f.use_smooth = True
    out = [o]
    fs = p.get("feathers")
    if fs:
        # the rim from point `from` to point `to` (going round), feathers spaced evenly along it, each
        # pointing out of the membrane in its own plane and rooted a third of its length inside the rim
        ring = [rim[(fs["from"] + i) % len(rim)] for i in range((fs["to"] - fs["from"]) % len(rim) + 1)]
        pts = {str(i): (*q, 0) for i, q in enumerate(ring)}
        for j, (at, _, e) in enumerate(along(pts, list(pts), fs["n"])):
            q = n.cross(e)
            if q.dot(at - c) < 0:
                q = -q
            ln = fs["len"] * (1 - 0.12 * (j % 3))  # a little ragged, the same every build
            root = at - q * (ln / 3)
            u = max(0.0, min(1.0, (root - c).length / max((at - c).length, 1e-6)))
            out.append(tube(f"{name}_f{j}", root + lift(u), q, ln, fs["base"], 0, fs.get("material", mat),
                            curve=fs.get("curve", 10), bend=-n * (1 if camber >= 0 else -1), flat=fs.get("flat", 0.25), segments=5, profile=vane))
    return out


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


def surface(nodes, blobs, at, r, up):
    """How far the flesh reaches from `at` along `up`: the chain's radius there, or further where a blob
    (an ellipsoid at a node, maybe tilted) lies over the chain, so a tuft or spike roots in the skin it
    shows through rather than deep inside a belly."""
    out = r
    for b in blobs:
        c = Vector(nodes[b["at"]][:3]) + Vector(b.get("off", (0, 0, 0)))
        m = Euler([math.radians(a) for a in b.get("rot", (0, 0, 0))]).to_matrix()
        p, d = m.transposed() @ (at - c), m.transposed() @ up
        p, d = Vector(x / y for x, y in zip(p, b["r"])), Vector(x / y for x, y in zip(d, b["r"]))
        # the far crossing of the unit sphere by the ray p + s d
        half, k = p.dot(d) / d.length_squared, (p.length_squared - 1) / d.length_squared
        if half * half - k >= 0:
            out = max(out, -half + math.sqrt(half * half - k))
    return out


def fan(nodes, blobs, p, side, sink, sweep):
    """Where each of a row of spikes or tufts along a chain grows: `n` along it, `rows` of them fanned
    `spread` degrees either side of the chain's top (a mane, a ruff, a moss mat, side rows on a shell),
    each swept `sweep` toward the chain's last node and tilted `tilt` out to the side. The top is the side
    facing up, or the back (-x) where the chain stands upright. Each roots `sink` of the way out to the
    flesh's surface (a blob's where one covers the chain). Yields (j, k, root, up, direction)."""
    chain = [mirrored(c) if side < 0 else c for c in p["along"]]
    rows, spread = p.get("rows", 1), math.radians(p.get("spread", 0))
    for j, (at, r, fwd) in enumerate(along(nodes, chain, p["n"])):
        top = Vector((0, 1, 0)) - fwd * fwd.y
        if top.length < 0.3:
            top = Vector((-1, 0, 0)) - fwd * -fwd.x
        top.normalize()
        for k in range(rows):
            a = spread * (2 * k / (rows - 1) - 1) if rows > 1 else 0
            up = Matrix.Rotation(a, 3, fwd) @ top
            d = up + fwd * p.get("sweep", sweep) + Vector((0, 0, p.get("tilt", 0) * side))
            yield j, k, at + up * (surface(nodes, blobs, at, r, up) * p.get("sink", sink)), up, d


def resolve(nodes, p):
    return Vector(nodes[p][:3]) if isinstance(p, str) else Vector(p)


def parts(sheet, nodes):
    out, blobs = [], sheet.get("blobs", [])
    for i, p in enumerate(sheet.get("parts", [])):
        for side in ([1, -1] if p.get("mirror") else [1]):
            s = lambda v: (v[0], v[1], v[2] * side)
            # a node name on the mirrored side is its r_ twin (already flipped); plain coordinates flip
            node = lambda k: tuple(nodes[mirrored(k) if side < 0 else k][:3]) if isinstance(k, str) else s(k)
            name = f"{p['kind']}{i}{'r' if side < 0 else ''}"
            if p["kind"] == "spikes" and not any(k in p for k in ("rows", "spread", "tilt")):
                for j, (at, r, fwd) in enumerate(along(nodes, p["along"], p["n"])):
                    top = at + Vector((0, surface(nodes, blobs, at, r, Vector((0, 1, 0))) * p.get("sink", 0.85), 0))
                    d = Vector((p.get("lean", -0.3), 1, 0))
                    out.append(cone(f"{name}_{j}", top, d, p["len"], p["base"], p["material"]))
            elif p["kind"] == "spikes":
                # side rows of shell spikes, a crest leaning off the centreline
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.85, 0.3):
                    out.append(cone(f"{name}_{j}_{k}", root, d, p["len"], p["base"], p["material"]))
            elif p["kind"] == "horn":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                d = Vector(s(p["dir"])).normalized()
                curve = math.radians(p.get("curve", 0))
                if any(k in p for k in ("curve", "tip_base", "flat")):
                    # an ox horn, a hooked beak, a club: bent `curve` degrees toward `bend`, `tip_base` thick at the end
                    bend = s(p["bend"]) if "bend" in p else None
                    out.append(tube(name, at, d, p["len"], p["base"], p.get("tip_base", 0), p["material"],
                                    curve=p.get("curve", 0), bend=bend, flat=p.get("flat", 1), segments=8, rings=8))
                    d, b = bend_frame(d, bend)
                else:
                    out.append(cone(name, at, d, p["len"], p["base"], p["material"]))
                    b = None
                # tines branch off the beam: [how far up it (0-1), direction, length], an antler not a spike
                for j, (t, td, tl) in enumerate(p.get("tines", [])):
                    root = arc(at, d, b, p["len"], curve, t)[0] if b is not None else at + d * (p["len"] * t)
                    out.append(cone(f"{name}_t{j}", root, s(td), tl, p["base"] * (1 - t) * 0.9, p["material"]))
            elif p["kind"] == "eye":
                at = Vector(node(p["at"])) + Vector(s(p["off"]))
                out.append(ball(name, at, p["r"], p["material"]))
            elif p["kind"] == "membrane":
                rim = pts = [node(q) for q in p["points"]]
                if "scallop" in p:
                    pts = scallop(pts, p["scallop"], p.get("scallop_depth", 0.25))
                if any(k in p for k in ("camber", "puff", "feathers")):
                    out += shell(name, pts, rim, p, side, p["material"])
                else:
                    out.append(sheet_face(name, pts, p.get("thick", 0.02), p["material"]))
            elif p["kind"] == "tuft":
                # fur: soft cones along a chain, flattened, swept back and curling onto the body; with
                # `spread` a fan of `rows` around the chain (a mane, a ruff) instead of one ridge
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.8, 1.5):
                    ln = p["len"] * (1 - 0.15 * ((j + k) % 3) / 2)  # ragged, the same every build
                    out.append(tube(f"{name}_{j}_{k}", root, d, ln, p["base"], 0,
                                    p.get("material", sheet.get("material", "hide")), curve=p.get("curve", 30),
                                    bend=-up, flat=p.get("flat", 0.3), segments=5, rings=3))
            elif p["kind"] == "scales":
                # plates: wide, flat and short, lying toward the chain's end, each over the one behind
                ov = p.get("overlap", 0.5)
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.9, 1 + 2 * ov):
                    out.append(tube(f"{name}_{j}_{k}", root, d, p["len"], p["base"], p["base"] * 0.5, p["material"],
                                    curve=20, bend=-up, flat=0.15, segments=6, rings=2))
            elif p["kind"] == "teeth":
                chain = [mirrored(c) if side < 0 else c for c in p["along"]]
                for j, (at, r, fwd) in enumerate(along(nodes, chain, p["n"])):
                    z = r * p.get("side", 0.7) * side
                    for lower in ([False, True] if p.get("lower") else [False]):
                        y = r * p.get("gap", 0.6) * (-1 if lower else 1)
                        out.append(cone(f"{name}_{j}{'l' if lower else 'u'}", at + Vector((0, y, z)),
                                        (0, 1 if lower else -1, 0), p["len"], p["base"], p["material"], segments=5))
            elif p["kind"] == "ear":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                d = Vector(s(p["dir"])).normalized() + Vector((0, 0, math.tan(math.radians(p.get("tilt", 0))) * side))
                out.append(tube(name, at, d.normalized(), p["len"], p["width"], 0, p["material"], curve=p.get("cup", 20),
                                bend=Vector((1, 0, 0)), flat=0.12, segments=6, profile=[(0, 0.55), (0.4, 1.0), (0.75, 0.8), (1, 0.1)]))
            elif p["kind"] == "ridge":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                bend = s(p["bend"]) if "bend" in p else None
                out.append(tube(name, at, Vector(s(p["dir"])).normalized(), p["len"], p["base"], 0, p.get("material", sheet.get("material", "hide")),
                                curve=p.get("curve", 0), bend=bend, flat=0.6, segments=5,
                                profile=[(0, 0.4), (0.3, 1.0), (0.7, 1.0), (1, 0.35)]))
            else:
                raise ValueError(f"unknown part kind {p['kind']}")
    return out


# --- out: one object, a GLB at the budget, a contact sheet ----------------------------------------------

def join(objs, name, sheet):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    if "scale" in sheet or "offset" in sheet:
        # the whole beast, parts and all: scaled about the ground under the origin, then moved
        k = sheet.get("scale", 1)
        o.data.transform(Matrix.Translation(sheet.get("offset", (0, 0, 0))) @ Matrix.Diagonal((*(k if isinstance(k, list) else [k] * 3), 1)))
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


def render(o, path, silhouette=False):
    """Three of it in a row (profile, facing you, three-quarter) by a 1 m post, in one PNG."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH" if silhouette else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1500, 600
    scene.render.film_transparent = False
    # no filmic roll-off: a glowing part keeps its colour as the game draws it (three.js, no tone mapping)
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    world.color = (0.62, 0.66, 0.72)
    scene.world = world
    if silhouette:  # flat black on white: only the outline reads
        sh = scene.display.shading
        sh.light, sh.color_type, sh.single_color, sh.show_cavity, sh.show_object_outline = "FLAT", "SINGLE", (0, 0, 0), False, False
        world.color = (1, 1, 1)
        scene.view_settings.view_transform = "Standard"
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
    if not silhouette:
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
        raise SystemExit("usage: blender -b --factory-startup -P blender/beast.py -- beasts/<id>.json [--render] [--silhouette]")
    with open(argv[0]) as f:
        sheet = json.load(f)
    PALETTE.update(sheet["palette"])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bod, nodes = body(sheet)
    beast = join([bod, *parts(sheet, nodes)], sheet["id"], sheet)
    lo, hi = [Vector(c) for c in (beast.bound_box[0], beast.bound_box[6])]
    print(f"{sheet['id']}: {tris(beast)} triangles, {hi.x - lo.x:.2f} long, {hi.y - lo.y:.2f} wide, {hi.z:.2f} tall")
    tone = (sheet.get("material", "hide"), sheet["belly"], sheet.get("belly_turn", -0.2)) if "belly" in sheet else None
    write_glb(beast, os.path.join(APP, "public", "models", sheet["id"] + ".glb"), sheet.get("budget", 3000), tone)
    if tone:
        two_tone(beast, *tone)
    if "--render" in argv:
        render(beast, os.path.join(HERE, "out", sheet["id"] + ".png"))
    if "--silhouette" in argv:
        render(beast, os.path.join(HERE, "out", sheet["id"] + ".silhouette.png"), silhouette=True)


main()
