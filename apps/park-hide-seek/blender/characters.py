# Campers, rangers and Bigfoot, modelled in Blender as body parts the page hangs on its joints.
#
#   blender -b --factory-startup -P apps/park-hide-seek/blender/characters.py -- [--render out-dir]
#
# Writes public/models/characters.glb: one mesh object per part, each with its origin on the joint it hangs
# from, in the game's frame and units (metres, feet at y = 0, facing +z). src/ui/characters.ts builds the same
# joints (hips at HIP_Y, knees THIGH below, shoulders, elbows, the head) and hangs these parts on them, so pose()
# walks and crouches them unchanged. Material slots are named by role ("shirt", "pants", "skin", "hat", ...);
# the page recolours them per Look, so the colours here only matter for the preview renders.
#
# The look: chunky, flat-shaded, low-poly, read from 30 m. Tapered limbs, a jacket with a hem and a stand-up
# collar, big hiking boots on thick soles, a slightly boxy head with eyes, brows, a round nose and ears.
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (GAME_TO_BLENDER, OUT, PALETTE, R, along, args, ball, box, hexrgb, join, loft,  # noqa: E402
                    render, reset, stage, tris, write_glb)

HIP_Y, THIGH, SHIN = 0.9, 0.43, 0.41


def U(y):
    """A height above the ground, as an offset from the hips (where everything above them hangs)."""
    return y - HIP_Y


def c(h, rough=0.85, metal=0.0, *glow):
    return (*hexrgb(h), rough, metal, *glow)


# Preview colours only: the page sets each slot from the player's Look.
PALETTE.update({
    "shirt": c("#d9482b"), "shirtDark": c("#86301f"), "zip": c("#5e2216"), "pocket": c("#a08a60"),
    "pants": c("#3b3f4a"), "pantsDark": c("#2c2f37"), "skin": c("#e0b089", 0.7), "skinDark": c("#c99a74", 0.7),
    "boot": c("#5a3b24"), "bootDark": c("#3d2818"), "sole": c("#1d1611"),
    "hair": c("#4f3220"), "brow": c("#3f2819"), "hat": c("#1aa39a"), "hatDark": c("#127068"), "pom": c("#f2efe6", 1),
    "band": c("#3b2a1a"), "pack": c("#e0a526"), "packDark": c("#86631a"), "strap": c("#654a13"), "roll": c("#5a6b3a"),
    "eyeWhite": c("#f7f4ee", 0.4), "pupil": c("#1b1712", 0.3), "mouth": c("#6e2f26"),
    "belt": c("#3b2a1a"), "patch": c("#5b6b3a"), "buckle": c("#c9a646", 0.35, 0.7), "badge": c("#e8c547", 0.3, 0.7),
    "stripe": c("#d8ff3a", 0.6, 0.0, 0.4), "torch": c("#2a2a2a", 0.4, 0.5), "lens": c("#fff8e0", 0.2, 0.0, 3.0),
    "fur": c("#4a3423", 1), "furDark": c("#33231a", 1), "hide": c("#2a1e17", 0.75), "bfEye": c("#f2c14e", 0.4, 0.0, 1.5),
})

PARTS = {}


HEAD = 1.1  # heads a touch big, so faces and hats read from across a meadow


def part(name, *pieces):
    PARTS[name] = join(list(pieces), name)


# ---- legs: the thigh hangs from the hip, the shin and boot from the knee -------------------------------------
def legs():
    part("thigh", loft("t", "pants", [R(0.07, 0.092, 0.098), R(0.0, 0.1, 0.106), R(-0.2, 0.09, 0.094),
                                       R(-0.38, 0.074, 0.078), R(-0.46, 0.066, 0.07)], p=2.2))
    part("shin",
         loft("s", "pants", [R(0.04, 0.07, 0.074), R(-0.12, 0.074, 0.08), R(-0.27, 0.064, 0.068)], p=2.2),
         loft("cuff", "pantsDark", [R(-0.24, 0.082, 0.086), R(-0.31, 0.08, 0.084)], p=2.2))
    part("boot",
         loft("shaft", "boot", [R(-0.285, 0.072, 0.077), R(-0.4, 0.078, 0.09, cz=0.01)], p=2.6),
         loft("collar", "bootDark", [R(-0.28, 0.079, 0.084), R(-0.31, 0.079, 0.084)], p=2.6),
         box("foot", "boot", (0.15, 0.1, 0.27), (0, -0.41, 0.045), bevel=0.035),
         box("toe", "bootDark", (0.152, 0.055, 0.07), (0, -0.428, 0.15), bevel=0.02),
         box("lace", "bootDark", (0.07, 0.012, 0.11), (0, -0.37, 0.085), rot=(0.5, 0, 0)),
         box("sole", "sole", (0.162, 0.034, 0.285), (0, -0.453, 0.045), bevel=0.01))


# ---- above the hips: pelvis, the camper's jacket or the ranger's shirt, a pack -------------------------------
def body():
    part("pelvis", loft("p", "pants", [R(U(1.07), 0.168, 0.115), R(U(0.97), 0.188, 0.128), R(U(0.88), 0.175, 0.118),
                                       R(U(0.82), 0.12, 0.09)], seg=10, p=2.6))

    def shell(mat="shirt"):
        return loft("torso", mat, [R(U(1.0), 0.178, 0.122), R(U(1.12), 0.176, 0.12), R(U(1.3), 0.2, 0.134),
                                   R(U(1.44), 0.208, 0.136), R(U(1.53), 0.185, 0.122), R(U(1.6), 0.118, 0.094)],
                    seg=10, p=2.3)

    def neck():
        return loft("neck", "skin", [R(U(1.58), 0.06, 0.058), R(U(1.73), 0.054, 0.052)], seg=8)

    collar = lambda: loft("collar", "shirtDark", [R(U(1.57), 0.118, 0.096), R(U(1.645), 0.092, 0.078)], seg=10)  # noqa: E731
    part("torso", shell(), neck(), collar(),
         loft("hem", "shirtDark", [R(U(0.975), 0.19, 0.134), R(U(1.065), 0.19, 0.134)], seg=10, p=2.3),
         box("zip", "zip", (0.018, 0.47, 0.03), (0, U(1.31), 0.118)),
         box("pullL", "zip", (0.022, 0.05, 0.02), (0, U(1.52), 0.128)))
    pockets = []
    for s in (-1, 1):
        pockets += [box("pocket", "pocket", (0.1, 0.095, 0.03), (0.088 * s, U(1.37), 0.118), bevel=0.008),
                    box("flap", "shirtDark", (0.106, 0.03, 0.034), (0.088 * s, U(1.425), 0.12), bevel=0.006)]
    part("rangerTorso", shell(), neck(), collar(), *pockets,
         box("placket", "shirtDark", (0.03, 0.42, 0.03), (0, U(1.3), 0.116)),
         loft("belt", "belt", [R(U(0.965), 0.19, 0.132), R(U(1.04), 0.19, 0.132)], seg=10, p=2.4),
         loft("stripeLo", "pantsDark", [R(U(1.1), 0.18, 0.124), R(U(1.11), 0.18, 0.124)], seg=10, p=2.3))
    # Shiny or glowing bits stay their own materials, so they're their own parts.
    part("buckle", box("b", "buckle", (0.065, 0.048, 0.02), (0, U(1.003), 0.13), bevel=0.006))
    part("badge", loft("b", "badge", [R(0.01, 0.036), R(-0.01, 0.036)], seg=6, rot=0,
                       m=along("z", (-0.088, U(1.462), 0.124))))
    part("stripe", loft("s", "stripe", [R(U(1.13), 0.186, 0.129), R(U(1.175), 0.19, 0.131)], seg=10, p=2.3))

    straps = []
    for s in (-1, 1):
        straps += [box("strapF", "strap", (0.036, 0.3, 0.02), (0.105 * s, U(1.41), 0.11), rot=(-0.14, 0, 0)),
                   box("tie", "strap", (0.03, 0.17, 0.17), (0.13 * s, U(1.0), -0.225))]
    part("pack",
         loft("bag", "pack", [R(U(1.08), 0.15, 0.075, cz=-0.225), R(U(1.42), 0.162, 0.088, cz=-0.225),
                              R(U(1.5), 0.145, 0.078, cz=-0.22)], seg=8, p=3.5),
         loft("lid", "packDark", [R(U(1.45), 0.168, 0.094, cz=-0.225), R(U(1.53), 0.15, 0.082, cz=-0.22),
                                  R(U(1.55), 0.1, 0.05, cz=-0.22)], seg=8, p=3.5),
         box("pocket", "packDark", (0.22, 0.16, 0.06), (0, U(1.21), -0.31), bevel=0.02),
         box("chest", "strap", (0.24, 0.025, 0.015), (0, U(1.42), 0.122)),
         loft("roll", "roll", [R(0.21, 0.078), R(-0.21, 0.078)], seg=10, m=along("x", (0, U(1.0), -0.225))),
         *straps)


# ---- arms: the upper arm hangs from the shoulder, the forearm, hand and flashlight from the elbow ------------
def arms():
    part("upperArm", loft("u", "shirt", [R(0.065, 0, 0), R(0.048, 0.054, 0.054), R(0.0, 0.07, 0.068),
                                         R(-0.15, 0.064, 0.064), R(-0.3, 0.057, 0.057)]))
    part("forearm",
         loft("f", "shirt", [R(0.035, 0.062, 0.062), R(-0.12, 0.059, 0.059), R(-0.22, 0.05, 0.05)]),
         loft("cuff", "shirtDark", [R(-0.2, 0.062, 0.062), R(-0.255, 0.06, 0.06)]))
    for side, s in (("L", -1), ("R", 1)):
        part("hand" + side,
             box("palm", "skin", (0.07, 0.105, 0.085), (0, -0.31, 0.006), bevel=0.026),
             box("thumb", "skin", (0.03, 0.06, 0.034), (-0.03 * s, -0.29, 0.045), bevel=0.011, rot=(0, 0, 0.35 * s)))
        part("patch" + side, loft("p", "patch", [R(0.006, 0.04), R(-0.006, 0.04)], seg=8, m=along("x", (0.074 * s, -0.08, 0))))
    # held in the right hand, pointing down the forearm: pose() raises that arm so it shines ahead
    part("flashlight",
         loft("body", "torch", [R(-0.28, 0.03), R(-0.48, 0.03)], seg=8),
         loft("bulb", "torch", [R(-0.475, 0.032), R(-0.545, 0.046)], seg=8))
    part("lens", loft("l", "lens", [R(-0.544, 0.04), R(-0.552, 0.04)], seg=8))


# ---- the head: hangs from the neck joint, face baked in; hair and hats on top -------------------------------
def head():
    skull = loft("skull", "skin", [R(-0.02, 0.06, 0.06, cz=0.015), R(0.045, 0.128, 0.128, cz=0.02),
                                   R(0.1, 0.156, 0.156, cz=0.01), R(0.17, 0.166, 0.162), R(0.245, 0.155, 0.15),
                                   R(0.3, 0.11, 0.108), R(0.325, 0, 0)], seg=12, p=2.3, smooth=True)
    face = [box("nose", "skinDark", (0.036, 0.046, 0.036), (0, 0.125, 0.162), bevel=0.013),
            box("mouth", "mouth", (0.05, 0.012, 0.02), (0, 0.075, 0.143), bevel=0.003)]
    for s in (-1, 1):
        face += [loft("eye", "eyeWhite", [R(0.009, 0.024, 0.03), R(-0.009, 0.024, 0.03)], seg=8, rot=0,
                      m=along("z", (0.058 * s, 0.165, 0.148))),
                 loft("pupil", "pupil", [R(0.004, 0.016, 0.021), R(-0.004, 0.016, 0.021)], seg=8, rot=0,
                      m=along("z", (0.059 * s, 0.162, 0.157))),
                 box("brow", "brow", (0.062, 0.018, 0.02), (0.06 * s, 0.205, 0.148), bevel=0.004, rot=(0, 0, -0.14 * s)),
                 ball("ear", "skin", 0.04, (0.163 * s, 0.14, -0.005), scale=(0.45, 1, 0.75), seg=6, rings=4)]
    part("head", skull, *face)

    cap = [R(0.14, 0.17, 0.172, cz=-0.006, tilt=0.09), R(0.225, 0.172, 0.17, cz=-0.004),
           R(0.29, 0.13, 0.13), R(0.345, 0, 0)]
    part("hair", loft("h", "hair", cap, seg=12, p=2.3),
         box("fringe", "hair", (0.21, 0.05, 0.08), (0.025, 0.27, 0.12), bevel=0.015, rot=(0.55, 0, -0.2)),
         box("tuft", "hair", (0.07, 0.05, 0.1), (-0.04, 0.33, 0.02), bevel=0.015, rot=(-0.3, 0, 0.4)))
    part("hairHat", loft("h", "hair", [R(0.14, 0.168, 0.17, cz=-0.006, tilt=0.07), R(0.22, 0.17, 0.168),
                                       R(0.27, 0.13, 0.13)], seg=12, p=2.3))

    part("beanie",
         loft("band", "hatDark", [R(0.2, 0.18, 0.178, tilt=0.03), R(0.27, 0.184, 0.182, tilt=0.03)], seg=12, p=2.3),
         loft("dome", "hat", [R(0.26, 0.176, 0.174, tilt=0.03), R(0.33, 0.152, 0.15), R(0.39, 0.09, 0.09),
                              R(0.41, 0, 0)], seg=12, p=2.3),
         ball("pom", "pom", 0.055, (0, 0.43, -0.012), seg=8, rings=4, jag=0.3))
    part("cap",
         loft("dome", "hat", [R(0.215, 0.178, 0.176, tilt=0.02), R(0.3, 0.156, 0.152), R(0.35, 0.09, 0.09),
                              R(0.365, 0, 0)], seg=12, p=2.3),
         loft("bill", "hatDark", [R(0.245, 0.135, 0.12, cz=0.17, tilt=-0.03), R(0.228, 0.135, 0.12, cz=0.17, tilt=-0.03)],
              seg=12, p=2.2),
         ball("button", "hatDark", 0.02, (0, 0.366, 0), seg=6, rings=3))
    part("bucket",
         loft("crown", "hat", [R(0.23, 0.172, 0.17), R(0.37, 0.146, 0.144)], seg=12, p=2.2),
         loft("band", "hatDark", [R(0.235, 0.177, 0.175), R(0.275, 0.175, 0.173)], seg=12, p=2.2),
         loft("brim", "hat", [R(0.252, 0.17, 0.168), R(0.192, 0.27, 0.265), R(0.176, 0.27, 0.265), R(0.235, 0.165, 0.163)],
              seg=12, closed=True))
    part("rangerHat",
         loft("brim", "hat", [R(0.262, 0.16), R(0.255, 0.315), R(0.237, 0.315), R(0.245, 0.16)], seg=16, closed=True),
         loft("band", "band", [R(0.25, 0.163), R(0.3, 0.159)], seg=12),
         loft("crown", "hat", [R(0.27, 0.159), R(0.36, 0.132, jag=-0.2), R(0.43, 0.088, jag=-0.35), R(0.445, 0, 0)],
              seg=8, rot=0))

    for name in ("head", "hair", "hairHat", "beanie", "cap", "bucket", "rangerHat"):
        PARTS[name].data.transform(Matrix.Diagonal((HEAD, HEAD, HEAD, 1)))


# ---- Bigfoot: his own joints (wider hips and shoulders, longer arms), all fur, a bare face -----------------
BF = {"hip": 0.13, "shoulder": (0.34, U(1.52)), "elbow": -0.36, "head": (0, U(1.66), 0.05)}


def bigfoot():
    part("bfThigh", loft("t", "fur", [R(0.09, 0.13), R(0.0, 0.142), R(-0.2, 0.128, jag=0.12), R(-0.42, 0.1, jag=0.3),
                                      R(-0.47, 0.09)], seg=10))
    toes = [box("toe", "hide", (0.045, 0.05, 0.06), (x, -0.45, 0.25), bevel=0.015) for x in (-0.06, 0, 0.06)]
    part("bfShin", loft("s", "fur", [R(0.04, 0.1), R(-0.14, 0.108, jag=0.15), R(-0.32, 0.088, jag=0.32), R(-0.37, 0.075)],
                        seg=10),
         box("foot", "hide", (0.19, 0.1, 0.4), (0, -0.42, 0.07), bevel=0.04), *toes)
    part("bfTorso",
         loft("t", "fur", [R(U(0.8), 0.18, 0.15), R(U(0.95), 0.27, 0.21, jag=0.35), R(U(1.18), 0.32, 0.24, jag=0.1),
                           R(U(1.42), 0.345, 0.255, cz=-0.03, jag=0.12), R(U(1.6), 0.31, 0.25, cz=-0.07, jag=0.3),
                           R(U(1.74), 0.17, 0.17, cz=-0.06), R(U(1.79), 0, 0, cz=-0.06)], seg=12))
    part("bfUpperArm", loft("u", "fur", [R(0.12, 0, 0), R(0.08, 0.1), R(0.0, 0.125, jag=0.15), R(-0.2, 0.105, jag=0.45),
                                         R(-0.4, 0.085)], seg=10))
    for side, s in (("L", -1), ("R", 1)):
        part("bfForearm" + side,
             loft("f", "fur", [R(0.03, 0.092), R(-0.15, 0.098, jag=0.45), R(-0.3, 0.08, jag=0.3), R(-0.34, 0.07)], seg=10),
             box("palm", "hide", (0.1, 0.17, 0.11), (0, -0.41, 0.01), bevel=0.035),
             box("thumb", "hide", (0.04, 0.08, 0.045), (-0.045 * s, -0.37, 0.06), bevel=0.015, rot=(0, 0, 0.35 * s)))
    eyes = []
    for s in (-1, 1):
        eyes.append(ball("eye", "bfEye", 0.022, (0.055 * s, 0.13, 0.19), seg=6, rings=3))
    part("bfHead",
         loft("skull", "fur", [R(0.0, 0.12, 0.12, cz=-0.02), R(0.08, 0.185, 0.18, jag=0.15), R(0.18, 0.185, 0.18),
                               R(0.27, 0.13, 0.14, cz=-0.03), R(0.34, 0.05, 0.09, cz=-0.05), R(0.35, 0, 0, cz=-0.06)], seg=10),
         ball("face", "hide", 0.13, (0, 0.1, 0.085), scale=(0.95, 1.0, 0.75), seg=10, rings=5),
         box("brow", "furDark", (0.25, 0.055, 0.075), (0, 0.175, 0.16), bevel=0.02),
         box("nose", "hide", (0.07, 0.05, 0.05), (0, 0.095, 0.19), bevel=0.016),
         box("mouth", "pupil", (0.08, 0.012, 0.02), (0, 0.04, 0.175)), *eyes)


# ---- preview: the parts hung on a rig like the page's, in a few poses ---------------------------------------
PERSON = {"hip": 0.1, "shoulder": (0.255, U(1.5)), "elbow": -0.28, "head": (0, U(1.68), 0)}
STAND = {"legs": (0, 0), "knees": (0, 0), "drop": 0, "upper": 0, "arms": (0, 0), "elbows": (-0.2, -0.2), "head": 0}
WALK = {"legs": (0.48, -0.48), "knees": (0.12, 0.62), "drop": 0.03, "upper": 0, "arms": (-0.36, 0.36), "elbows": (-0.7, -0.7), "head": 0}
CROUCH = {"legs": (-1, -1), "knees": (2, 2), "drop": 0.386, "upper": 0.42, "arms": (-0.15, -0.15), "elbows": (-0.7, -0.7), "head": -0.3}
LIGHT = {"arms": (0, -0.65), "elbows": (-0.2, -0.75)}  # the ranger's flashlight arm


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def rot(x=0.0, z=0.0):
    return Matrix.Rotation(x, 4, "X") @ Matrix.Rotation(z, 4, "Z")


def figure(at, yaw, outfit, pose, joints=PERSON, scale=1.0):
    """Linked copies of the parts, placed the way the page's joint groups place them."""
    root = T(*at) @ Matrix.Rotation(yaw, 4, "Y") @ Matrix.Diagonal((scale, scale, scale, 1))
    body = root @ T(0, -pose["drop"], 0)
    upper = body @ T(0, HIP_Y, 0) @ rot(pose["upper"])
    hx = joints["hip"]
    sx, sy = joints["shoulder"]
    place = {"upper": upper, "head": upper @ T(*joints["head"]) @ rot(pose["head"])}
    for i, s in enumerate((-1, 1)):
        hip = body @ T(hx * s, HIP_Y, 0) @ rot(pose["legs"][i])
        shoulder = upper @ T(sx * s, sy, 0) @ rot(pose["arms"][i], 0.08 * s)
        place[f"legs{i}"], place[f"knees{i}"] = hip, hip @ T(0, -THIGH, 0) @ rot(pose["knees"][i])
        place[f"arms{i}"] = shoulder
        place[f"elbows{i}"] = shoulder @ T(0, joints["elbow"], 0) @ rot(pose["elbows"][i])
    count = 0
    for joint, names in outfit.items():
        for name in names:
            src = PARTS[name]
            o = src.copy()
            o.hide_render = False
            bpy.context.collection.objects.link(o)
            o.matrix_world = GAME_TO_BLENDER @ place[joint] @ GAME_TO_BLENDER.inverted()
            count += tris(src)
    return count


def person(hat="beanie", pack=True, ranger=False):
    """Which parts go on which joint: the same table src/ui/characters.ts keeps."""
    top = "rangerHat" if ranger else hat
    o = {"legs0": ["thigh"], "legs1": ["thigh"], "knees0": ["shin", "boot"], "knees1": ["shin", "boot"],
         "upper": ["pelvis", "rangerTorso" if ranger else "torso"], "arms0": ["upperArm"], "arms1": ["upperArm"],
         "elbows0": ["forearm", "handL"], "elbows1": ["forearm", "handR"],
         "head": ["head", "hair" if top == "none" else "hairHat"] + ([] if top == "none" else [top])}
    if ranger:
        o["upper"] += ["buckle", "badge", "stripe"]
        o["arms0"].append("patchL")
        o["arms1"].append("patchR")
        o["elbows1"] += ["flashlight", "lens"]
    elif pack:
        o["upper"].append("pack")
    return o


BIGFOOT = {"legs0": ["bfThigh"], "legs1": ["bfThigh"], "knees0": ["bfShin"], "knees1": ["bfShin"], "upper": ["bfTorso"],
           "arms0": ["bfUpperArm"], "arms1": ["bfUpperArm"], "elbows0": ["bfForearmL"], "elbows1": ["bfForearmR"],
           "head": ["bfHead"]}


def preview(out):
    for o in PARTS.values():
        o.hide_render = True
    stage()
    with_light = {**STAND, **LIGHT}
    print("camper", figure((-1.6, 0, 0), 0, person("beanie"), STAND), "triangles")
    figure((-0.8, 0, 0), 0, person("cap", pack=False), WALK)
    figure((0, 0, 0), 0, person("bucket"), STAND)
    figure((0.8, 0, 0), 0, person("none", pack=False), STAND)
    print("ranger", figure((1.6, 0, 0), 0, person(ranger=True), with_light), "triangles")
    print("bigfoot", figure((2.9, 0, 0), 0, BIGFOOT, STAND, BF, 1.4), "triangles")
    figure((-2.9, 0, 0), 0, person("cap"), CROUCH)
    render(os.path.join(out, "lineup.png"), (("-front", (0.3, -7.5, 1.4)), ("-back", (0.3, 7.5, 1.6))),
           target=(0.3, 0, 1.0), size=(1600, 700), lens=40)
    render(os.path.join(out, "lineup.png"), (("-34", (4.5, -6.0, 2.0)),), target=(0.0, 0, 0.9), size=(1600, 800), lens=45)
    render(os.path.join(out, "lineup.png"), (("-ranger", (3.2, -4.2, 1.7)),), target=(2.2, 0, 1.2), size=(1200, 900), lens=45)
    render(os.path.join(out, "lineup.png"), (("-bigfoot", (4.9, -3.6, 2.6)),), target=(2.9, 0, 1.5), size=(1000, 1000), lens=40)
    render(os.path.join(out, "faces.png"), (("", (-0.4, -2.2, 1.65)),), target=(-0.4, 0, 1.7), size=(1400, 600), lens=60)


def main():
    reset()
    legs(), body(), arms(), head(), bigfoot()
    for name, o in PARTS.items():
        print(f"  {name}: {tris(o)}")
    write_glb(list(PARTS.values()), os.path.join(OUT, "characters.glb"))
    if "--render" in args():
        preview(os.path.abspath(args()[args().index("--render") + 1]))


main()
