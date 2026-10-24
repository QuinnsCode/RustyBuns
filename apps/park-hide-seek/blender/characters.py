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
# The look: chunky, flat-shaded, low-poly, read from 30 m. A camper wears a quilted puffer jacket with a hood
# on its back and drawcords at the collar, cargo pants, laced hiking boots on thick soles, and one of three hair
# styles (short, curly, long) under a beanie, cap or bucket hat. A ranger wears the campaign hat (dented crown,
# band and a brass badge), a shirt with pleated pockets, epaulettes, a tie, a badge and a name plate, a duty
# belt with a radio and a pouch, a shoulder mic with a red light, and carries a big flashlight. Hands have
# fingers and a thumb. Heads are a touch big, with a nose bridge, lids over the eyes and a smile.
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
    "bottle": c("#7fb3c8", 0.5), "eyeWhite": c("#f7f4ee", 0.4), "pupil": c("#1b1712", 0.3), "mouth": c("#6e2f26"),
    "belt": c("#3b2a1a"), "patch": c("#5b6b3a"), "radio": c("#1e2226", 0.6),
    "buckle": c("#c9a646", 0.35, 0.7), "badge": c("#e8c547", 0.3, 0.7),
    "stripe": c("#d8ff3a", 0.6, 0.0, 0.4), "torch": c("#2a2a2a", 0.4, 0.5), "lens": c("#fff8e0", 0.2, 0.0, 3.0),
    "led": c("#ff3b2f", 0.4, 0.0, 2.0),
    "fur": c("#4a3423", 1), "furDark": c("#33231a", 1), "hide": c("#2a1e17", 0.75), "bfEye": c("#f2c14e", 0.4, 0.0, 1.5),
})

PARTS = {}


HEAD = 1.1  # heads a touch big, so faces and hats read from across a meadow


def part(name, *pieces):
    PARTS[name] = join(list(pieces), name)


# ---- legs: the thigh hangs from the hip, the shin and boot from the knee -------------------------------------
def legs():
    part("thigh",
         loft("t", "pants", [R(0.07, 0.092, 0.098), R(0.0, 0.1, 0.106), R(-0.2, 0.09, 0.094),
                             R(-0.38, 0.074, 0.078), R(-0.46, 0.066, 0.07)], p=2.2),
         # a cargo pocket on the front of the thigh, with its flap
         box("cargo", "pantsDark", (0.08, 0.09, 0.022), (0, -0.225, 0.084), bevel=0.006),
         box("cargoFlap", "pantsDark", (0.086, 0.026, 0.028), (0, -0.172, 0.085), bevel=0.005))
    part("shin",
         loft("s", "pants", [R(0.04, 0.07, 0.074), R(-0.12, 0.074, 0.08), R(-0.27, 0.064, 0.068)], p=2.2),
         loft("cuff", "pantsDark", [R(-0.24, 0.082, 0.086), R(-0.31, 0.08, 0.084)], p=2.2))
    laces = [box("lace", "sole", (0.08, 0.012, 0.012), (0, -0.305 - i * 0.034, 0.086 + i * 0.005),
                 rot=(0, 0, 0.55 if i % 2 else -0.55)) for i in range(3)]
    part("boot",
         loft("shaft", "boot", [R(-0.27, 0.074, 0.08), R(-0.34, 0.078, 0.087), R(-0.405, 0.082, 0.095, cz=0.012)], p=2.6),
         loft("collar", "bootDark", [R(-0.262, 0.081, 0.088), R(-0.295, 0.081, 0.088)], p=2.6),
         box("tongue", "bootDark", (0.05, 0.1, 0.02), (0, -0.325, 0.085), bevel=0.005, rot=(-0.22, 0, 0)),
         *laces,
         box("foot", "boot", (0.15, 0.1, 0.27), (0, -0.41, 0.045), bevel=0.035),
         box("toe", "bootDark", (0.152, 0.06, 0.075), (0, -0.428, 0.15), bevel=0.02),
         box("heel", "bootDark", (0.152, 0.06, 0.07), (0, -0.428, -0.06), bevel=0.02),
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

    # The puffer jacket: raised seams between its baffles, a hood lying on the back, drawcords, a zipped chest pocket.
    quilt = [loft(f"quilt{i}", "shirtDark", [R(U(y) - 0.006, rx, rz), R(U(y) + 0.006, rx, rz)], seg=10, p=2.3)
             for i, (y, rx, rz) in enumerate(((1.13, 0.181, 0.125), (1.235, 0.196, 0.134), (1.34, 0.208, 0.14), (1.445, 0.212, 0.141)))]
    cords = [box("cord", "zip", (0.012, 0.1, 0.012), (0.045 * s, U(1.5), 0.128)) for s in (-1, 1)]
    part("torso", shell(), neck(), collar(), *quilt, *cords,
         loft("hem", "shirtDark", [R(U(0.975), 0.19, 0.134), R(U(1.065), 0.19, 0.134)], seg=10, p=2.3),
         loft("hood", "shirt", [R(U(1.5), 0.13, 0.06, cz=-0.1), R(U(1.6), 0.15, 0.085, cz=-0.13),
                                R(U(1.68), 0.12, 0.07, cz=-0.15), R(U(1.72), 0, 0, cz=-0.16)], seg=10, p=2.4),
         box("zip", "zip", (0.018, 0.47, 0.03), (0, U(1.31), 0.126)),
         box("pullL", "zip", (0.022, 0.05, 0.02), (0, U(1.52), 0.136)),
         box("chestPocket", "shirtDark", (0.085, 0.07, 0.014), (0.095, U(1.37), 0.136), bevel=0.004),
         box("pocketZip", "zip", (0.085, 0.01, 0.01), (0.095, U(1.4), 0.144)))

    # The ranger's shirt: pleated pockets with button flaps, epaulettes, a tie down the placket, a duty belt with
    # a radio on the left hip and a pouch on the right, and a shoulder mic clipped by the collar.
    pockets = []
    for s in (-1, 1):
        pockets += [box("pocket", "pocket", (0.1, 0.095, 0.03), (0.088 * s, U(1.37), 0.122), bevel=0.008),
                    box("pleat", "shirtDark", (0.012, 0.085, 0.036), (0.088 * s, U(1.365), 0.123)),
                    box("flap", "shirtDark", (0.106, 0.03, 0.036), (0.088 * s, U(1.425), 0.124), bevel=0.006),
                    ball("button", "band", 0.009, (0.088 * s, U(1.414), 0.143), seg=6, rings=3),
                    box("epaulette", "shirtDark", (0.12, 0.016, 0.05), (0.16 * s, U(1.582), 0.0), bevel=0.004,
                        rot=(0, 0, -0.2 * s)),
                    ball("epButton", "band", 0.011, (0.105 * s, U(1.6), 0.0), seg=6, rings=3)]
    part("rangerTorso", shell(), neck(), collar(), *pockets,
         box("placket", "shirtDark", (0.03, 0.42, 0.03), (0, U(1.3), 0.116)),
         box("tie", "band", (0.042, 0.3, 0.016), (0, U(1.4), 0.13), bevel=0.004),
         box("knot", "band", (0.052, 0.042, 0.028), (0, U(1.565), 0.108), bevel=0.006),
         loft("belt", "belt", [R(U(0.955), 0.194, 0.136), R(U(1.045), 0.194, 0.136)], seg=10, p=2.4),
         box("radio", "radio", (0.036, 0.1, 0.05), (-0.212, U(1.0), -0.005), bevel=0.006),
         box("antenna", "radio", (0.01, 0.11, 0.01), (-0.212, U(1.095), -0.015)),
         box("pouch", "belt", (0.04, 0.075, 0.08), (0.212, U(0.995), 0.0), bevel=0.008),
         box("pouchFlap", "band", (0.044, 0.025, 0.084), (0.212, U(1.028), 0.0), bevel=0.005),
         box("mic", "radio", (0.036, 0.046, 0.026), (-0.108, U(1.515), 0.118), bevel=0.005, rot=(0.25, 0, 0)),
         loft("stripeLo", "pantsDark", [R(U(1.1), 0.18, 0.124), R(U(1.11), 0.18, 0.124)], seg=10, p=2.3))
    # Shiny or glowing bits stay their own materials, so they're their own parts.
    part("buckle", box("b", "buckle", (0.065, 0.048, 0.02), (0, U(1.003), 0.134), bevel=0.006))
    part("badge", loft("b", "badge", [R(0.01, 0.036), R(-0.01, 0.036)], seg=6, rot=0,
                       m=along("z", (-0.088, U(1.462), 0.124))),
         box("plate", "badge", (0.072, 0.018, 0.01), (0.088, U(1.462), 0.138)))
    part("stripe", loft("s", "stripe", [R(U(1.13), 0.186, 0.129), R(U(1.175), 0.19, 0.131)], seg=10, p=2.3))
    part("led", ball("l", "led", 0.007, (-0.108, U(1.532), 0.136), seg=6, rings=3))

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
         box("sidePocket", "packDark", (0.05, 0.14, 0.1), (-0.178, U(1.2), -0.225), bevel=0.012),
         # a water bottle in the right side pocket
         loft("bottle", "bottle", [R(U(1.12), 0.034), R(U(1.3), 0.034), R(U(1.325), 0.022)], seg=8,
              m=Matrix.Translation((0.182, 0, -0.225))),
         loft("cap", "band", [R(U(1.32), 0.024), R(U(1.36), 0.024)], seg=8, m=Matrix.Translation((0.182, 0, -0.225))),
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
        fingers = [box("finger", "skin", (0.016, 0.06, 0.022), (-0.0255 + i * 0.017, -0.355, 0.012), bevel=0.004)
                   for i in range(4)]
        part("hand" + side,
             box("palm", "skin", (0.072, 0.085, 0.036), (0, -0.295, 0.01), bevel=0.012),
             box("thumb", "skin", (0.022, 0.055, 0.024), (-0.042 * s, -0.305, 0.028), bevel=0.008, rot=(0, 0, 0.4 * s)),
             *fingers)
        part("patch" + side, loft("p", "patch", [R(0.006, 0.04), R(-0.006, 0.04)], seg=8, m=along("x", (0.074 * s, -0.08, 0))))
    # held in the right hand, pointing down the forearm: pose() raises that arm so it shines ahead
    part("flashlight",
         loft("body", "torch", [R(-0.26, 0.03), R(-0.5, 0.03)], seg=8),
         loft("grip1", "torch", [R(-0.3, 0.035), R(-0.34, 0.035)], seg=8),
         loft("grip2", "torch", [R(-0.37, 0.035), R(-0.41, 0.035)], seg=8),
         loft("head", "torch", [R(-0.495, 0.034), R(-0.56, 0.054), R(-0.578, 0.054)], seg=10),
         box("switch", "band", (0.018, 0.03, 0.012), (0, -0.28, 0.036)))
    part("lens", loft("l", "lens", [R(-0.577, 0.047), R(-0.585, 0.047)], seg=10))


# ---- the head: hangs from the neck joint, face baked in; hair and hats on top -------------------------------
def head():
    skull = loft("skull", "skin", [R(-0.02, 0.06, 0.06, cz=0.015), R(0.045, 0.128, 0.124, cz=0.02),
                                   R(0.1, 0.156, 0.154, cz=0.01), R(0.17, 0.166, 0.162), R(0.245, 0.155, 0.15),
                                   R(0.3, 0.11, 0.108), R(0.325, 0, 0)], seg=12, p=2.4, smooth=True)
    face = [box("nose", "skinDark", (0.04, 0.048, 0.04), (0, 0.122, 0.164), bevel=0.013),
            box("bridge", "skinDark", (0.024, 0.045, 0.022), (0, 0.158, 0.156), bevel=0.006)]
    for s in (-1, 1):
        face += [loft("eye", "eyeWhite", [R(0.009, 0.024, 0.03), R(-0.009, 0.024, 0.03)], seg=8, rot=0,
                      m=along("z", (0.058 * s, 0.165, 0.148))),
                 loft("pupil", "pupil", [R(0.004, 0.016, 0.021), R(-0.004, 0.016, 0.021)], seg=8, rot=0,
                      m=along("z", (0.059 * s, 0.162, 0.157))),
                 box("lid", "skinDark", (0.05, 0.009, 0.02), (0.058 * s, 0.184, 0.148), bevel=0.002),
                 box("brow", "brow", (0.064, 0.018, 0.02), (0.06 * s, 0.212, 0.148), bevel=0.004, rot=(0, 0, -0.14 * s)),
                 # a smile: each half rises towards its corner
                 box("mouth", "mouth", (0.032, 0.011, 0.016), (0.019 * s, 0.078, 0.147), rot=(0, 0, 0.4 * s)),
                 ball("ear", "skin", 0.04, (0.163 * s, 0.14, -0.005), scale=(0.45, 1, 0.75), seg=6, rings=4)]
    part("head", skull, *face)

    # Three hair styles with no hat on (short and swept, curly, long down the back), and what shows under a hat.
    cap = [R(0.14, 0.17, 0.172, cz=-0.006, tilt=0.09), R(0.225, 0.172, 0.17, cz=-0.004), R(0.29, 0.13, 0.13), R(0.345, 0, 0)]
    fringe = lambda: box("fringe", "hair", (0.21, 0.05, 0.08), (0.025, 0.27, 0.12), bevel=0.015, rot=(0.55, 0, -0.2))  # noqa: E731
    back = lambda: loft("back", "hair", [R(-0.18, 0.08, 0.03, cz=-0.11), R(-0.12, 0.12, 0.045, cz=-0.12),  # noqa: E731
                                         R(0.05, 0.15, 0.05, cz=-0.13), R(0.2, 0.14, 0.05, cz=-0.12)], seg=8, p=2.4)
    locks = lambda: [box("lock", "hair", (0.045, 0.22, 0.065), (0.152 * s, 0.06, 0.035), bevel=0.012) for s in (-1, 1)]  # noqa: E731
    part("hair", loft("h", "hair", cap, seg=12, p=2.3), fringe(),
         box("tuft", "hair", (0.07, 0.05, 0.1), (-0.04, 0.33, 0.02), bevel=0.015, rot=(-0.3, 0, 0.4)))
    part("hairCurly", loft("h", "hair", [R(0.13, 0.17, 0.172, cz=-0.006, tilt=0.09), R(0.2, 0.192, 0.19, cz=-0.01, jag=0.16),
                                         R(0.28, 0.168, 0.164, jag=0.2), R(0.35, 0.1, 0.1, jag=0.25), R(0.378, 0, 0)],
                           seg=14, p=2.2, rot=0))
    part("hairLong", loft("h", "hair", cap, seg=12, p=2.3), fringe(), back(), *locks())
    under = [R(0.14, 0.168, 0.17, cz=-0.006, tilt=0.07), R(0.22, 0.17, 0.168), R(0.27, 0.13, 0.13)]
    part("hairHat", loft("h", "hair", under, seg=12, p=2.3))
    part("hairHatLong", loft("h", "hair", under, seg=12, p=2.3), back(), *locks())

    part("beanie",
         loft("band", "hatDark", [R(0.19, 0.183, 0.181, tilt=0.03, jag=0.035), R(0.275, 0.187, 0.185, tilt=0.03, jag=0.035)],
              seg=16, p=2.3),
         loft("dome", "hat", [R(0.265, 0.177, 0.175, tilt=0.03, jag=0.03), R(0.33, 0.153, 0.151, jag=0.03),
                              R(0.39, 0.09, 0.09, jag=0.03), R(0.41, 0, 0)], seg=16, p=2.3),
         ball("pom", "pom", 0.055, (0, 0.43, -0.012), seg=8, rings=4, jag=0.3))
    part("cap",
         loft("dome", "hat", [R(0.215, 0.178, 0.176, tilt=0.02), R(0.3, 0.156, 0.152), R(0.35, 0.09, 0.09),
                              R(0.365, 0, 0)], seg=12, p=2.3),
         loft("bill", "hatDark", [R(0.245, 0.14, 0.125, cz=0.17, tilt=-0.04), R(0.228, 0.14, 0.125, cz=0.17, tilt=-0.04)],
              seg=12, p=2.2),
         box("snap", "hatDark", (0.07, 0.022, 0.012), (0, 0.25, -0.172)),
         ball("button", "hatDark", 0.02, (0, 0.366, 0), seg=6, rings=3))
    part("bucket",
         loft("crown", "hat", [R(0.23, 0.172, 0.17), R(0.37, 0.146, 0.144)], seg=12, p=2.2),
         loft("band", "hatDark", [R(0.235, 0.177, 0.175), R(0.275, 0.175, 0.173)], seg=12, p=2.2),
         loft("brim", "hat", [R(0.252, 0.17, 0.168), R(0.192, 0.27, 0.265), R(0.176, 0.27, 0.265), R(0.235, 0.165, 0.163)],
              seg=12, closed=True),
         loft("stitch", "hatDark", [R(0.209, 0.236, 0.233), R(0.219, 0.236, 0.233)], seg=12),
         # a chin cord from the brim, with a toggle under the chin
         *[box("cordSide", "band", (0.009, 0.27, 0.009), (0.172 * s, 0.085, 0.035), rot=(0.08, 0, 0.06 * s)) for s in (-1, 1)],
         box("cordChin", "band", (0.33, 0.009, 0.009), (0, -0.04, 0.06)),
         box("toggle", "hatDark", (0.03, 0.022, 0.022), (0, -0.04, 0.065), bevel=0.004))
    # The campaign hat: a wide brim that curls up at its edge, a band, and a crown pinched in at four points.
    part("rangerHat",
         loft("brim", "hat", [R(0.262, 0.16), R(0.248, 0.3), R(0.268, 0.335), R(0.25, 0.335), R(0.232, 0.3), R(0.245, 0.16)],
              seg=16, closed=True),
         loft("band", "band", [R(0.25, 0.163), R(0.305, 0.159)], seg=12),
         loft("crown", "hat", [R(0.27, 0.159), R(0.33, 0.152, jag=-0.12), R(0.4, 0.138, jag=-0.3), R(0.45, 0.105, jag=-0.4),
                               R(0.468, 0.045, jag=-0.4), R(0.472, 0, 0)], seg=8, rot=0))
    part("hatBadge", loft("b", "badge", [R(0.008, 0.028), R(-0.008, 0.028)], seg=6, rot=0, m=along("z", (0, 0.28, 0.163))))

    for name in ("head", "hair", "hairCurly", "hairLong", "hairHat", "hairHatLong", "beanie", "cap", "bucket", "rangerHat", "hatBadge"):
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


HAIR = {"short": ("hair", "hairHat"), "curly": ("hairCurly", "hairHat"), "long": ("hairLong", "hairHatLong")}


def person(hat="beanie", pack=True, ranger=False, hair="short"):
    """Which parts go on which joint: the same table src/ui/characters.ts keeps."""
    top = "rangerHat" if ranger else hat
    bare, under = HAIR[hair]
    o = {"legs0": ["thigh"], "legs1": ["thigh"], "knees0": ["shin", "boot"], "knees1": ["shin", "boot"],
         "upper": ["pelvis", "rangerTorso" if ranger else "torso"], "arms0": ["upperArm"], "arms1": ["upperArm"],
         "elbows0": ["forearm", "handL"], "elbows1": ["forearm", "handR"],
         "head": ["head", bare if top == "none" else under] + ([] if top == "none" else [top])}
    if ranger:
        o["upper"] += ["buckle", "badge", "stripe", "led"]
        o["head"].append("hatBadge")
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
    figure((-2.4, 0, 0), 0, person("cap", hair="long"), CROUCH)
    print("camper", figure((-1.6, 0, 0), 0, person("beanie"), STAND), "triangles")
    figure((-0.8, 0, 0), 0, person("cap", pack=False, hair="curly"), WALK)
    figure((0, 0, 0), 0, person("bucket", hair="long"), STAND)
    figure((0.8, 0, 0), 0, person("none", pack=False, hair="curly"), STAND)
    figure((1.6, 0, 0), 0, person("none", hair="long"), STAND)
    print("ranger", figure((2.4, 0, 0), 0, person(ranger=True), with_light), "triangles")
    print("bigfoot", figure((3.7, 0, 0), 0, BIGFOOT, STAND, BF, 1.4), "triangles")
    render(os.path.join(out, "lineup.png"), (("-front", (0.6, -8.5, 1.4)), ("-back", (0.6, 8.5, 1.6))),
           target=(0.6, 0, 1.0), size=(1800, 700), lens=38)
    render(os.path.join(out, "lineup.png"), (("-34", (4.5, -6.0, 2.0)),), target=(0.4, 0, 0.9), size=(1600, 800), lens=45)
    render(os.path.join(out, "lineup.png"), (("-ranger", (3.6, -3.6, 1.7)),), target=(2.6, 0, 1.15), size=(1200, 1000), lens=50)
    render(os.path.join(out, "lineup.png"), (("-bigfoot", (5.7, -3.6, 2.6)),), target=(3.7, 0, 1.5), size=(1000, 1000), lens=40)
    render(os.path.join(out, "faces.png"), (("", (0.0, -2.4, 1.65)),), target=(0.0, 0, 1.68), size=(1600, 600), lens=55)
    render(os.path.join(out, "faces.png"), (("-hats", (-1.2, -2.4, 1.7)),), target=(-1.2, 0, 1.68), size=(1400, 600), lens=55)
    render(os.path.join(out, "faces.png"), (("-close", (0.8, -1.3, 1.72)),), target=(0.8, 0, 1.72), size=(800, 800), lens=80)


def main():
    reset()
    legs(), body(), arms(), head(), bigfoot()
    for name, o in PARTS.items():
        print(f"  {name}: {tris(o)}")
    write_glb(list(PARTS.values()), os.path.join(OUT, "characters.glb"))
    if "--render" in args():
        preview(os.path.abspath(args()[args().index("--render") + 1]))


main()
