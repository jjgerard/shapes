#!/usr/bin/env python3
"""
The hinge for the arms of the three-arm pieces.

An arm is a fixed-length bar on a round hub. The hub turns in a bore in the
piece's body and clicks at five angles (0, +-25, +-50 degrees from straight
down). The click is a FACE DETENT: five short V-grooves on each end face of
the hub, and a small wedge ("nose") on a flexure plate that presses on the
face. When the wedge sits in a groove the arm is locked; to move it the hub
has to push the plate away by a fraction of a millimetre, which takes torque.

    hub (turns)           lid plates (screwed on, one each end)
      z                     each has a flexure beam with a wedge under it
      |  top lid  ----+-----------  beam  <- nose presses on the hub face
      |  hub  = = = = = (grooves on the end faces)
      |  bottom lid --+-----------
      +-- housing: a block with a bore and a slot for the arm to swing in

This script
  1. works out how much torque a hinge has to hold, from the game's own trees
     (laid out with the arm design from arms.py, using this hinge's pitch and
     arm width),
  2. checks that neighbouring hinges do not foul each other's arms,
  3. computes the detent torque from the real groove/nose profile and the
     flexure's stiffness, and checks the flexure stress,
  4. builds the printable parts (STL) and checks the actual meshes: the hub
     must turn through its whole range without touching the housing, and the
     interference between nose and groove, measured in 3D at every angle, must
     match the profile model.

Run from the repo root:  python3 physical/hinge.py
"""
import itertools, json, math, os, statistics, sys
from collections import defaultdict
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon, cylinder, box as tbox
from trimesh.boolean import union, difference, intersection
from shapely.geometry import Polygon, Point, LineString, box as sbox
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import spokes as sp

OUT = os.path.join(HERE, 'hinge')
os.makedirs(OUT, exist_ok=True)
ENGINE = 'manifold'

# --- the design (mm) ----------------------------------------------------------
CLICKS = [-50, -25, 0, 25, 50]       # degrees from straight down; + is to the right
ARM_LEN = 80.0
ARM_W = 5.0                          # in the plane of the tree
ARM_Z = 9.0                          # thickness along the hub axis
R_H, R_B = 6.0, 6.25                 # hub radius, bore radius (0.25 mm clearance)
R_SLEEVE = R_B + 1.0                 # housing wall around a bore
PITCH = 16.0                         # between neighbouring hinge axes
L_H = 12.0                           # hub length
GAP = 0.8                            # hub end face to lid plate
SLOT_HALF = 82.0                     # half-angle of the arm's swing slot, around "straight down"
# detent
R_M = 4.5                            # radius of the groove ring
G_LEN = 1.6                          # groove length (radial)
G_W = 1.2                            # groove width at the face
FLANK = 55.0                         # flank angle from the face plane
DELTA0 = 0.5                         # how far the nose presses into the flexure at rest
NOSE_LEN = 1.2
# flexure (lid)
BEAM_W, BEAM_Y_NOSE, BEAM_Y_ANCHOR = 11.0, R_M, 17.0
SLOT_W = 0.6
E_PETG = 1500.0                      # N/mm^2, conservative for printed PETG
SIGMA_OK = 25.0                      # N/mm^2 allowed in the flexure (about 1.7 % strain)
T_VARIANTS = [1.6, 2.0, 2.4]         # lid / flexure thickness variants
T_DESIGN = 2.0
# loads
MASS = {0: 8.0, 1: 9.0, 2: 13.0, 3: 19.0}   # grams per piece by number of slots: ASSUMPTION
G = 9.81e-3
TARGET_HOLD = 250.0                  # N*mm the detent should hold
MAX_RELEASE = 500.0                  # N*mm a hand should be able to overcome

TANF = math.tan(math.radians(FLANK))
H_G = (G_W / 2) * TANF               # groove depth
TIP_W = G_W - 2 * DELTA0 / TANF      # nose tip width: zero play when seated
BEAM_L = BEAM_Y_ANCHOR - BEAM_Y_NOSE


# =============================================================================
# 1. loads, from the game's trees
# =============================================================================
def arm_design():
    A.ARM_T, A.PIVOT_PITCH, A.HUB = ARM_W, PITCH, 2 * R_SLEEVE
    s = A.settings([ARM_LEN], CLICKS)
    return {1: A.STUB, 2: s, 3: s}


def unique_trees():
    seen, out = set(), []
    for n, t in A.load_trees():
        if repr(t) in seen: continue
        seen.add(repr(t)); out.append((n, t))
    return out


def loads(res):
    out = []
    for name, ok, parts in res:
        bodies = {i[1]: (g.centroid, i[0]) for k, g, i in parts if k == 'body'}
        kids = defaultdict(list); arms = []
        for k, g, i in parts:
            if k == 'arm':
                kids[i[3]].append(i[4]); arms.append((g, i))
        def sub(u):
            return [u] + [x for c in kids[u] for x in sub(c)]
        for g, (st, t, slot, pu, cu) in arms:
            if st.length < 30: continue                          # stubs do not hinge
            (px, py) = list(g.coords)[0]
            W = Mw = Mh = 0.0
            for u in sub(cu):
                c, ty = bodies[u]
                m = MASS[len(sp.PORTS.get(ty, {}))]
                W += m
                Mw += m * G * math.hypot(c.x - px, c.y - py)       # worst orientation: any tilt
                Mh += m * G * abs(c.x - px)                        # hanging, as built
            Mw += 2.2 * G * st.length / 2; W += 2.2                # this arm's own weight
            out.append(dict(tree=name, piece=t, grams=W, M_worst=Mw, M_hang=Mh))
    return out


def pct(a, p):
    a = sorted(a)
    return a[min(len(a) - 1, int(p * len(a)))]


def requirements():
    trees = unique_trees()
    S = arm_design()
    res, stats = A.evaluate(trees, S, 40.0)
    problems = []
    for name, ok, parts in res:
        if not ok: problems.append(f'{name}: cannot be laid out')
        problems += [f'{name}: {p}' for p in A.verify_parts(parts)]
    L = loads(res)
    w = [x['M_worst'] for x in L]; h = [x['M_hang'] for x in L]
    return dict(trees=len(trees), problems=problems, arms=len(L),
                worst=dict(median=statistics.median(w), p75=pct(w, .75), p90=pct(w, .9), max=max(w)),
                hang=dict(median=statistics.median(h), p75=pct(h, .75), p90=pct(h, .9), max=max(h)),
                w_all=w, h_all=h, top=sorted(L, key=lambda x: -x['M_worst'])[:3])


# =============================================================================
# 2. neighbouring hinges
# =============================================================================
def swing_clearance():
    """Closest an arm comes to its neighbour's housing sleeve, over the clicks."""
    worst = (1e9, None)
    for a in CLICKS:
        d = (math.sin(math.radians(a)), math.cos(math.radians(a)))
        axis = LineString([(d[0] * R_SLEEVE, d[1] * R_SLEEVE), (d[0] * ARM_LEN, d[1] * ARM_LEN)])
        for nx in (-PITCH, PITCH):
            c = axis.distance(Point(nx, 0)) - ARM_W / 2 - R_SLEEVE
            if c < worst[0]: worst = (c, (a, nx))
    return worst


def slot_margin():
    """Angle by which the arm's swing clears the slot walls: the arm's edge near
    the hub sweeps wider than its centre line."""
    edge = math.degrees(math.asin((ARM_W / 2) / R_H))
    return SLOT_HALF - (max(abs(c) for c in CLICKS) + edge), edge


# =============================================================================
# 3. detent mechanics
# =============================================================================
def beam(t):
    k = E_PETG * BEAM_W * t ** 3 / (4 * BEAM_L ** 3)                  # N/mm, one flexure
    sigma = 3 * E_PETG * t * DELTA0 / (2 * BEAM_L ** 2)               # N/mm^2 at full deflection
    return k, sigma


def torque_peak(t, mu):
    """Torque to push the arm out of a click: both flexures, full deflection."""
    k, _ = beam(t)
    ktot = 2 * k
    return R_M * ktot * DELTA0 * (TANF + mu) / (1 - mu * TANF)


def torque_curve(t, mu, angles):
    """Torque the detent exerts on the arm vs. arm angle (positive pushes the
    arm towards larger angles). Deflection of the flexure is d = clip(|u| tan(flank), 0, delta0),
    u = arc distance from the nearest groove centre."""
    k, _ = beam(t)
    ktot = 2 * k
    out = []
    for a in angles:
        k_near = min(CLICKS, key=lambda c: abs(c - a))
        u = R_M * math.radians(a - k_near)
        d = min(DELTA0, abs(u) * TANF)
        ramp = abs(u) * TANF < DELTA0
        F = ktot * d
        sign = -1 if u > 0 else 1
        tau = sign * R_M * F * TANF if ramp else 0.0                   # restoring torque on the ramp
        out.append(tau)
    return np.array(out)


# =============================================================================
# 4. the 3D parts
# =============================================================================
def rot_x(deg): return trimesh.transformations.rotation_matrix(math.radians(deg), [1, 0, 0])
def rot_z(deg): return trimesh.transformations.rotation_matrix(math.radians(deg), [0, 0, 1])
def rot_y(deg): return trimesh.transformations.rotation_matrix(math.radians(deg), [0, 1, 0])


def fix(m):
    if m.volume < 0: m.invert()
    return m


def slab(x0, x1, y0, y1, z0, z1):
    m = tbox(extents=[x1 - x0, y1 - y0, z1 - z0])
    m.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    return m


def cyl(r, z0, z1, x=0.0, y=0.0, sections=96):
    m = cylinder(radius=r, height=z1 - z0, sections=sections)
    m.apply_translation([x, y, (z0 + z1) / 2])
    return m


def wedge_prism(pts_xz, y0, y1):
    """A prism with the given (x, z) cross-section, running along y from y0 to y1."""
    m = extrude_polygon(Polygon([(x, -z) for x, z in pts_xz]), y1 - y0, engine='earcut')
    m.apply_transform(rot_x(-90))
    m.apply_translation([0, y0, 0])
    return fix(m)


def groove(face_z, up, phi):
    """V-groove cut into a hub end face, at hub angle phi (degrees, counter-clockwise from +x).
    up=+1 cuts down from the top face, up=-1 cuts up from the bottom face."""
    e = 0.3
    xe = (H_G + e) / TANF
    s = -up                                           # direction of the cut, away from the face
    pts = [(-xe, face_z - s * e), (xe, face_z - s * e), (0, face_z + s * H_G)]
    m = wedge_prism(pts, R_M - G_LEN / 2, R_M + G_LEN / 2)       # along +y, which is phi = 90
    m.apply_transform(rot_z(phi - 90))
    return m


def hub_arm():
    parts = [cyl(R_H, 0, L_H)]
    arm = slab(-ARM_W / 2, ARM_W / 2, -ARM_LEN, -(R_H - 0.5), 0, ARM_Z)
    parts.append(arm)
    body = union(parts, engine=ENGINE)
    cuts = [cyl(2.0, -1, ARM_Z + 1, 0, -(ARM_LEN - 7))]                       # hanger hole
    for a in CLICKS:
        phi = 90 - a
        cuts.append(groove(L_H, +1, phi))
        cuts.append(groove(0.0, -1, phi))
    return fix(difference([body] + cuts, engine=ENGINE))


Y_MIN, Y_MAX, X_HALF = -7.6, 21.0, 12.5
Z_LO, Z_HI = -GAP, L_H + GAP                                      # housing spans the hub plus the two gaps
SCREWS = [(sx * 10.0, y) for sx in (-1, 1) for y in (4.0, 18.0)]


def housing():
    blk = slab(-X_HALF, X_HALF, Y_MIN, Y_MAX, Z_LO, Z_HI)
    cuts = [cyl(R_B, Z_LO - 1, Z_HI + 1)]
    pts = [(0, 0)] + [(40 * math.cos(math.radians(-90 + a)), 40 * math.sin(math.radians(-90 + a)))
                      for a in np.linspace(-SLOT_HALF, SLOT_HALF, 60)]
    sector = extrude_polygon(Polygon(pts), (ARM_Z + 0.4) - (Z_LO - 1), engine='earcut')
    sector.apply_translation([0, 0, Z_LO - 1])
    cuts.append(sector)
    cuts += [cyl(1.7, Z_LO - 1, Z_HI + 1, x, y, 24) for x, y in SCREWS]
    return fix(difference([blk] + cuts, engine=ENGINE))


def nose_wedge(z_root, direction):
    """The wedge under a flexure; direction -1 points down from z_root."""
    p = GAP + DELTA0
    t = TANF
    pts = [(-TIP_W / 2, z_root + direction * p), (TIP_W / 2, z_root + direction * p),
           ((TIP_W + 2 * (p + 0.1) / t) / 2, z_root - direction * 0.1), (-(TIP_W + 2 * (p + 0.1) / t) / 2, z_root - direction * 0.1)]
    return wedge_prism(pts, R_M - NOSE_LEN / 2, R_M + NOSE_LEN / 2)


def lid_installed(t, with_nose=True):
    """The top lid in place: plate on the housing, nose pointing down."""
    z0 = Z_HI
    plate = slab(-X_HALF, X_HALF, Y_MIN, Y_MAX, z0, z0 + t)
    yb0 = R_M - 2.9                                                    # free end of the beam
    cuts = [slab(-BEAM_W / 2 - SLOT_W, -BEAM_W / 2, yb0 - SLOT_W, BEAM_Y_ANCHOR, z0 - 1, z0 + t + 1),
            slab(BEAM_W / 2, BEAM_W / 2 + SLOT_W, yb0 - SLOT_W, BEAM_Y_ANCHOR, z0 - 1, z0 + t + 1),
            slab(-BEAM_W / 2 - SLOT_W, BEAM_W / 2 + SLOT_W, yb0 - SLOT_W, yb0, z0 - 1, z0 + t + 1)]
    cuts += [cyl(1.7, z0 - 1, z0 + t + 1, x, y, 24) for x, y in SCREWS]
    pl = fix(difference([plate] + cuts, engine=ENGINE))
    if not with_nose: return pl
    return fix(union([pl, nose_wedge(z0, -1)], engine=ENGINE))


def lid_print(t):
    """The lid as printed: plate on the bed, nose up (rotated 180 degrees about y)."""
    m = lid_installed(t)
    m.apply_transform(rot_y(180))
    m.apply_translation([0, 0, -m.bounds[0][2]])
    return m


def mirrored_bottom(m):
    """The bottom lid is the top lid turned over about the hub's mid-plane."""
    b = m.copy()
    b.apply_transform(rot_y(180))
    b.apply_translation([0, 0, L_H])
    return b


# =============================================================================
# 5. checks on the real meshes
# =============================================================================
def health(m):
    return dict(watertight=bool(m.is_watertight), volume=bool(m.is_volume), mm3=round(float(m.volume), 1),
                size=[round(float(x), 1) for x in m.extents])


def overlap(a, b):
    r = intersection([a, b], engine=ENGINE)
    return float(r.volume) if len(r.faces) else 0.0


def turned(m, deg):
    t = m.copy(); t.apply_transform(rot_z(deg)); return t


def predicted_overlap_area(u):
    """Cross-section area (mm^2) where the nose wedge at arc offset u overlaps hub
    material, from the profile in the face plane."""
    top = 0.0
    hub = sbox(-50, -50, 50, top)                                      # solid below the face plane z=0 (face at 0)
    for k in range(-3, 4):
        # grooves are spaced R_M * 25 degrees apart along the arc
        c = k * R_M * math.radians(25)
        xe = (H_G + 0.3) / TANF
        hub = hub.difference(Polygon([(c - xe, 0.3), (c + xe, 0.3), (c, -H_G)]))
    p = GAP + DELTA0
    # nose with its tip DELTA0 below the face plane, wider upward
    tip_z = -DELTA0
    wz = 2 * (DELTA0 + 0.1) / TANF
    nose = Polygon([(u - TIP_W / 2, tip_z), (u + TIP_W / 2, tip_z),
                    (u + (TIP_W + 2 * (p + 0.1) / TANF) / 2, tip_z + p + 0.1),
                    (u - (TIP_W + 2 * (p + 0.1) / TANF) / 2, tip_z + p + 0.1)])
    return hub.intersection(nose).area


def build_and_check(t=T_DESIGN):
    res = {}
    hub = hub_arm(); hsg = housing()
    lid_top = lid_installed(t); lid_bot = mirrored_bottom(lid_top)
    plate_top = lid_installed(t, with_nose=False); plate_bot = mirrored_bottom(plate_top)
    nose_top = nose_wedge(Z_HI, -1)
    nose_bot = nose_top.copy(); nose_bot.apply_transform(rot_y(180)); nose_bot.apply_translation([0, 0, L_H])
    meshes = {'housing': hsg, 'hub_arm': hub}
    for n in T_VARIANTS:
        meshes[f'lid_t{int(round(n * 10)):02d}'] = lid_print(n)
    res['health'] = {k: health(m) for k, m in meshes.items()}

    # (a) the hub turns freely through its whole range
    free = {}
    for a in range(-60, 61, 5):
        free[a] = overlap(turned(hub, a), hsg) + overlap(turned(hub, a), plate_top) + overlap(turned(hub, a), plate_bot)
    res['free_turn'] = free

    # (b) the detent interference, measured in 3D, against the profile model
    angles = [x * 0.5 for x in range(-120, 121, 1)][::2]                # every 1 degree
    meas, pred = [], []
    for a in angles:
        h = turned(hub, a)
        v = overlap(h, nose_top) + overlap(h, nose_bot)
        meas.append(v)
        k_near = min(CLICKS, key=lambda c: abs(c - a))
        u = R_M * math.radians(a - k_near)
        pred.append(2 * NOSE_LEN * predicted_overlap_area(u))
    res['detent'] = dict(angles=angles, measured=meas, predicted=pred)
    return meshes, res, dict(hub=hub, housing=hsg, lid_top=lid_top, lid_bot=lid_bot)


# =============================================================================
# 6. drawings
# =============================================================================
def torque_figure(req, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    ang = np.linspace(-62, 62, 1241)
    fig, ax = plt.subplots(1, 2, figsize=(14, 5.2), facecolor='white')
    cols = dict(zip(T_VARIANTS, ('#8aa4d6', '#2f5db8', '#173a7a')))
    for t in T_VARIANTS:
        ax[0].plot(ang, torque_curve(t, 0, ang), color=cols[t], lw=1.8, label=f'flexure {t} mm')
    for a in CLICKS: ax[0].axvline(a, color='#ccd', lw=0.8, ls=':')
    ax[0].axhline(0, color='#999', lw=0.6)
    ax[0].set_xlabel('arm angle from straight down (degrees)'); ax[0].set_ylabel('torque the detent puts on the arm (N·mm)')
    ax[0].set_title('Detent torque vs arm angle (frictionless profile model)\nlocks at each click, free between them', fontsize=11)
    ax[0].legend(frameon=False, fontsize=9)
    # holding strength vs the loads
    xs = sorted(req['w_all'])
    cov = lambda T, arr: 100 * sum(1 for v in arr if v <= T) / len(arr)
    Ts = np.linspace(0, 700, 200)
    ax[1].plot(Ts, [cov(T, req['h_all']) for T in Ts], color='#2a9d6f', lw=2, label='hanging as built')
    ax[1].plot(Ts, [cov(T, req['w_all']) for T in Ts], color='#c0392b', lw=2, label='worst tilt, any orientation')
    for t, ls in zip(T_VARIANTS, ('--', '-', ':')):
        for mu, a in ((0.0, 0.9), (0.3, 0.45)):
            ax[1].axvline(torque_peak(t, mu), color=cols[t], lw=1.3, alpha=a, ls=ls)
    ax[1].axvline(TARGET_HOLD, color='k', lw=1.2); ax[1].axvline(MAX_RELEASE, color='k', lw=1.0, ls='--'); ax[1].text(MAX_RELEASE + 6, 20, 'hand limit 500', fontsize=9)
    ax[1].text(TARGET_HOLD + 6, 8, 'target 250', fontsize=9)
    ax[1].set_xlabel('torque the hinge holds (N·mm)'); ax[1].set_ylabel('% of the game\'s hinged arms held')
    ax[1].set_title('How much of the game each hold strength covers\n(blue lines: the three flexures, without / with friction)', fontsize=11)
    ax[1].legend(frameon=False, fontsize=9, loc='lower right'); ax[1].set_ylim(0, 102)
    fig.tight_layout(); fig.savefig(path, dpi=120)


def section_polys(mesh):
    """Cross-section of a mesh by the plane x = 0, as shapely polygons in (y, z)."""
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import polygonize, unary_union as uu
    segs = trimesh.intersections.mesh_plane(mesh, [1, 0, 0], [0, 0, 0])
    # round so that segment ends that should meet really do (a loop that fails to close drops out of the section)
    r = lambda v: round(float(v), 5)
    lines = [LineString([(r(p[0][1]), r(p[0][2])), (r(p[1][1]), r(p[1][2]))]) for p in segs]
    polys = list(polygonize(uu(lines)))
    # polygonize returns every enclosed face; keep material, drop the holes it reports as faces
    out = uu(polys)
    return out


def parts_figure(parts, path):
    sys.path.insert(0, HERE)
    import coupon as C
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MPoly
    hub, hsg, lid = parts['hub'], parts['housing'], parts['lid_top']
    fig = plt.figure(figsize=(22, 5.6), facecolor='white')
    gs = fig.add_gridspec(1, 5, width_ratios=[1, 1, 1, 1.7, 0.01])
    for i, (title, m) in enumerate([('housing', hsg), ('hub and arm', hub), ('top lid (as installed)', lid)]):
        ax = fig.add_subplot(gs[0, i])
        ax.imshow(C.render(m, w=520, h=520, elev=26.0, azim=-58.0)); ax.set_axis_off(); ax.set_title(title, fontsize=12)
    ax = fig.add_subplot(gs[0, 3])
    colors = [('housing', hsg, '#b9c0cc'), ('hub and arm', hub, '#2f5db8'), ('top lid', lid, '#2a9d6f'), ('bottom lid', parts['lid_bot'], '#2a9d6f')]
    for name, m, col in colors:
        geom = section_polys(m)
        for poly in (geom.geoms if hasattr(geom, 'geoms') else [geom]):
            if poly.is_empty: continue
            ax.add_patch(MPoly(list(poly.exterior.coords), closed=True, facecolor=col, edgecolor='#223', lw=0.8, alpha=0.95))
            for hole in poly.interiors:
                ax.add_patch(MPoly(list(hole.coords), closed=True, facecolor='white', edgecolor='#223', lw=0.8))
    ax.set_xlim(-11, 23); ax.set_ylim(-5.5, 19); ax.set_aspect('equal')
    ax.set_xlabel('y (mm)'); ax.set_ylabel('z, along the hub axis (mm)')
    ax.set_title('assembled, cut through the hub axis at the 0° click', fontsize=12)
    ax.annotate('wedge seated in a groove', (4.5, 11.6), (8.5, 15.2), fontsize=9, arrowprops=dict(arrowstyle='->'))
    ax.annotate('flexure beam (lid plate)', (12, 13.8), (14, 17.2), fontsize=9, arrowprops=dict(arrowstyle='->'))
    ax.annotate('arm', (-8, 4), (-10.5, 9.5), fontsize=9, arrowprops=dict(arrowstyle='->'))
    ax.annotate('hub', (0, 8), (-3.5, 15.5), fontsize=9, arrowprops=dict(arrowstyle='->'))
    fig.tight_layout(); fig.savefig(path, dpi=110)


# =============================================================================
def main():
    print('== loads')
    req = requirements()
    print(f'   {req["trees"]} trees, {req["arms"]} hinged arms; layout problems: {req["problems"] or "none"}')
    print('   worst tilt N*mm:', {k: round(v) for k, v in req['worst'].items()})
    print('   hanging    N*mm:', {k: round(v) for k, v in req['hang'].items()})
    clr, where = swing_clearance()
    margin, edge = slot_margin()
    print(f'== geometry: clearance of an arm to its neighbour\'s sleeve {clr:.2f} mm (at click {where}); '
          f'slot margin {margin:.1f} deg (arm edge sweeps {edge:.1f} deg wider than its centre line)')

    print('== detent model')
    table = []
    for t in T_VARIANTS:
        k, s = beam(t)
        row = dict(t=t, k=k, sigma=s, strain=100 * s / E_PETG,
                   T0=torque_peak(t, 0.0), T3=torque_peak(t, 0.3), T45=torque_peak(t, 0.45),
                   hold_friction=0.3 * R_M * 2 * k * DELTA0)
        row['cover_hang'] = 100 * sum(1 for v in req['h_all'] if v <= row['T0']) / len(req['h_all'])
        row['cover_worst'] = 100 * sum(1 for v in req['w_all'] if v <= row['T0']) / len(req['w_all'])
        row['cover_hang3'] = 100 * sum(1 for v in req['h_all'] if v <= row['T3']) / len(req['h_all'])
        row['cover_worst3'] = 100 * sum(1 for v in req['w_all'] if v <= row['T3']) / len(req['w_all'])
        table.append(row)
        print(f'   t={t}: k={k:.1f} N/mm each, stress {s:.1f} MPa ({row["strain"]:.1f} %), peak {row["T0"]:.0f} / {row["T3"]:.0f} / {row["T45"]:.0f} N*mm '
              f'(mu 0 / .3 / .45), land friction {row["hold_friction"]:.0f}; covers {row["cover_hang"]:.0f}% hanging, {row["cover_worst"]:.0f}% worst tilt')

    print('== building the parts')
    meshes, chk, parts = build_and_check(T_DESIGN)
    for n, m in meshes.items():
        m.export(os.path.join(OUT, f'hinge_{n}.stl'))
        print(f'   {n}: {chk["health"][n]}')
    bad_mesh = [n for n, h in chk['health'].items() if not (h['watertight'] and h['volume'])]

    fails = []
    # free turning
    inside = {a: v for a, v in chk['free_turn'].items() if abs(a) <= 55}
    outside = {a: v for a, v in chk['free_turn'].items() if abs(a) >= 60}
    print('   free turn: max overlap for |angle| <= 55 :', f'{max(inside.values()):.3f} mm3', '| at 60 degrees:', {a: round(v, 1) for a, v in outside.items()})
    if max(inside.values()) > 0.01: fails.append('the hub touches the housing within its swing')
    if not all(v > 0.01 for v in outside.values()): fails.append('the slot-limit check is not sensitive (no overlap beyond the slot)')

    d = chk['detent']
    ang, mv, pv = np.array(d['angles']), np.array(d['measured']), np.array(d['predicted'])
    seated = [mv[i] for i, a in enumerate(ang) if a in CLICKS]
    on_land = [i for i, a in enumerate(ang) if abs(a - min(CLICKS, key=lambda c: abs(c - a))) * R_M * math.pi / 180 > H_G / TANF + 0.1]
    err = max(abs(mv[i] - pv[i]) / max(pv[i], 1e-6) for i in on_land) if on_land else float('nan')
    corr = float(np.corrcoef(mv, pv)[0, 1])
    print(f'   detent overlap in 3D: seated at the clicks {max(seated):.3f} mm3 (want ~0); on the lands up to {mv.max():.2f} mm3; '
          f'profile-model correlation {corr:.3f}, worst land error {100 * err:.0f}%')
    if max(seated) > 0.05: fails.append(f'the nose interferes with the groove when seated ({max(seated):.2f} mm3)')
    if corr < 0.97: fails.append(f'3D interference does not follow the profile model (r={corr:.2f})')
    if bad_mesh: fails.append(f'bad meshes: {bad_mesh}')

    torque_figure(req, os.path.join(OUT, 'torque.png'))
    parts_figure(parts, os.path.join(OUT, 'parts.png'))
    json.dump(dict(design=dict(clicks=CLICKS, arm_length=ARM_LEN, arm_width=ARM_W, pitch=PITCH, hub_radius=R_H, bore_radius=R_B,
                               groove_ring_radius=R_M, flank_deg=FLANK, delta0=DELTA0, beam_width=BEAM_W, beam_length=BEAM_L,
                               design_thickness=T_DESIGN, target_hold=TARGET_HOLD),
                   loads={k: {a: round(b) for a, b in v.items()} for k, v in (('worst', req['worst']), ('hanging', req['hang']))},
                   variants=table, clearance=clr, slot_margin=margin, checks=dict(corr=corr, free_turn=chk['free_turn'])),
              open(os.path.join(OUT, 'hinge.json'), 'w'), indent=1, default=float)
    write_doc(req, table, clr, margin, edge, chk, corr, err, fails)
    if fails:
        print('FAILED:', *fails, sep='\n  ')
        sys.exit(1)
    print('all hinge checks passed')


def write_doc(req, table, clr, margin, edge, chk, corr, err, fails):
    w, h = req['worst'], req['hang']
    dsg = next(r for r in table if abs(r['t'] - T_DESIGN) < 1e-6)
    L = ['# Hinge\n',
         'Generated by `physical/hinge.py`. Parts: `physical/hinge/*.stl`. Figures: `physical/hinge/torque.png`, `physical/hinge/parts.png`.\n',
         '## What it has to hold\n',
         f'Computed from the game\'s own trees (the {req["trees"]} distinct ones), laid out with the arm design (80 mm arms, 16 mm hinge pitch, 5 mm-wide arms), '
         f'by adding up the weight of everything that hangs from each of the {req["arms"]} hinged arms. Piece masses are **assumed** '
         f'(heads 8 g, one-slot 9 g, two-slot 13 g, three-slot 19 g, printed in PETG at about 30% effective fill); the torques scale directly with that.\n',
         '| Torque on a hinge (N·mm) | median | 75% of arms | 90% of arms | largest |', '|---|---|---|---|---|',
         f'| hanging as built | {h["median"]:.0f} | {h["p75"]:.0f} | {h["p90"]:.0f} | {h["max"]:.0f} |',
         f'| worst tilt (held sideways) | {w["median"]:.0f} | {w["p75"]:.0f} | {w["p90"]:.0f} | {w["max"]:.0f} |', '',
         'The load is very uneven: most arms carry almost nothing, and a handful at the top of the biggest trees carry a lot. The three heaviest:',
         *[f'- {sp.label(x["piece"])} in "{x["tree"]}": {x["grams"]:.0f} g hanging, {x["M_worst"]:.0f} N·mm worst tilt' for x in req['top']],
         '', f'**Target: hold {TARGET_HOLD:.0f} N·mm, and let a hand overcome it (under {MAX_RELEASE:.0f} N·mm, which is about 6 N at the arm tip).** '
         'That is a firm hinge, not a loose one. Trees laid flat on a table put no gravity load on their hinges at all; '
         'the load only matters when a phrase is lifted.\n',
         '## The mechanism\n',
         'A **face detent**: five V-grooves on each end face of the hub (at the five clicks), and on each end a **wedge on a flexure plate** '
         'pressing on the face. Seated in a groove the arm is locked; to turn it the hub has to push the plate back by 0.5 mm, '
         'which takes torque. Between the clicks the wedge rides on the flat face and the arm is held only by light friction.\n',
         '```',
         '   top lid     ======= beam =======      <- wedge presses on the hub face',
         '   hub         = = = grooves = = =',
         '   bottom lid  ======= beam =======',
         '   housing: a block with a bore for the hub and a slot for the arm to swing in',
         '```\n',
         '| Part | What it is |', '|---|---|',
         f'| hub and arm | hub Ø{2 * R_H:.0f} × {L_H:.0f} mm with the arm {ARM_W:.0f} × {ARM_Z:.0f} mm, {ARM_LEN:.0f} mm from the axis; 5 grooves on each hub face; a Ø4 hole near the arm tip for hanging weights in tests |',
         f'| housing | block with a Ø{2 * R_B:.1f} bore ({R_B - R_H:.2f} mm clearance), a slot {2 * SLOT_HALF:.0f}° wide for the arm, and four M3 screw holes |',
         '| two lids | identical plates, one on each end, each with a flexure beam and wedge; screwed to the housing (the real piece would use snap hooks) |', '',
         f'Why these numbers: the hinges are {PITCH:.0f} mm apart because a 12 mm hub in a 1 mm wall needs that much room for a neighbour\'s arm to swing under it at 50° '
         f'(measured clearance **{clr:.2f} mm**). The arm is only {ARM_W:.0f} mm wide, because a wider arm\'s edges sweep so far near the hub that the slot would have to open to '
         f'180° and the hub would no longer be held (the narrow arm\'s edge sweeps {edge:.1f}° wider than its centre line; the slot has **{margin:.1f}°** of margin beyond ±50°). '
         f'Both changes were fed back into the layout: all {req["trees"]} distinct game trees still build.\n',
         '## Detent torque\n',
         f'The torque is set by the flexure stiffness, how far the wedge has to be pushed (δ = {DELTA0} mm), the ring radius ({R_M} mm) and the flank angle ({FLANK:.0f}°). '
         'The peak torque to leave a click (both flexures) is `2 k δ r tan(flank)` without friction, and `(tan + μ)/(1 − μ tan)` times that with it.\n',
         '| Flexure thickness | stiffness each | stress at full push | strain | peak torque, no friction | μ = 0.3 | μ = 0.45 | friction between clicks (μ 0.3) | arms held, no friction (hanging / worst tilt) | arms held at μ 0.3 (hanging / worst tilt) |',
         '|---|---|---|---|---|---|---|---|---|---|']
    for r in table:
        mark = ' **(design)**' if abs(r['t'] - T_DESIGN) < 1e-6 else ''
        L.append(f'| {r["t"]} mm{mark} | {r["k"]:.1f} N/mm | {r["sigma"]:.1f} MPa | {r["strain"]:.1f}% | {r["T0"]:.0f} N·mm | {r["T3"]:.0f} | {r["T45"]:.0f} | {r["hold_friction"]:.0f} N·mm | {r["cover_hang"]:.0f}% / {r["cover_worst"]:.0f}% | {r["cover_hang3"]:.0f}% / {r["cover_worst3"]:.0f}% |')
    L += ['',
          'These are **calculated, not measured**. They assume printed PETG with a stiffness of 1500 N/mm² (±30%) and a friction coefficient between 0.15 and 0.45, so the real hold is a range. '
          f'The **{T_DESIGN} mm flexure is the design point**: it holds {dsg["T0"]:.0f} N·mm even with no friction, about {dsg["T3"]:.0f} N·mm at a typical μ of 0.3 (right on the 250 N·mm target), '
          f'and still releases under {MAX_RELEASE:.0f} N·mm ({dsg["T45"]:.0f} N·mm at μ 0.45). The thicker flexure is stiffer than a hand should have to overcome if the surfaces are grippy, '
          'and the thinner one is the fallback if they are. The stress is under 1.5% strain at every thickness.\n',
          '![torque](torque.png)\n',
          '## What the script checked on the real meshes\n',
          f'- All parts are watertight solids.',
          f'- **The hub turns freely through ±55°** without touching the housing or the lid plates (largest overlap {max(v for a, v in chk["free_turn"].items() if abs(a) <= 55):.3f} mm³), '
          'and it does touch at ±60°, so the check can see a collision.',
          f'- **The detent interference measured in 3D matches the profile model** (correlation {corr:.3f} over 121 angles; the worst error on a land is {100 * err:.0f}%). '
          'The wedge sits in each groove with no interference (zero play), and rides up onto the flat face between clicks.',
          '', '![parts](parts.png)\n',
          '## Print and test it\n',
          'Print the housing and the hub and arm as modelled (axis vertical, arm flat on the bed), and **two lids of the same thickness** (printed plate down, wedge up). '
          'The bottom lid is the same part as the top lid, turned over. You need four M3 screws and nuts (20 to 25 mm long) per hinge. PETG is recommended, 0.2 mm layers, 3 perimeters, 40% or more infill in the arm. '
          'The grooves on the hub\'s bottom face sit against the bed, so turn on elephant-foot compensation or check that they came out clean. '
          'The slot ceiling in the housing bridges a wide gap, so use supports there or accept some sag.\n',
          f'Test one lid thickness at a time ({", ".join(str(t) for t in T_VARIANTS)} mm):',
          '1. Assemble, and turn the arm by hand through all five clicks. Does each click feel distinct, and does the arm hold between them?',
          '2. **Measure the hold.** Put the housing on its side so the arm points horizontally at the 0° click (use the arm\'s hole at 73 mm from the axis). '
          'Hang a bag from the hole and add weight until the arm drops out of the click. The torque is `mass (kg) × 9.81 × 73 mm`; 250 N·mm is about 350 g.',
          '3. Repeat after 50 turns of the arm through all the clicks, to see whether the flexures wear or the hold fades.\n',
          '## What this does not settle\n',
          '- **Real hold.** The numbers above are a prediction; the test in the previous section is what decides the thickness.',
          '- **Assembly.** The coupon uses screws. The real piece needs a snap-on lid (or one lid carrying all three flexures) and a way for the hub to go in; and it must be strong enough that a student cannot pull the arm off.',
          '- **Unused arms** still need a stow position; the hinge turns ±50° and the slot opens ±82°, so a folded-back arm is not possible with this layout. '
          'The simplest answer is arms that can be taken off. With this design that means taking a lid off, so a quick-release version would have to be designed.',
          '- **Wear.** Printed flexures that are bent 0.5 mm every click will creep over time; the 50-cycle test in step 3 is a first look.',
          '- **Print resolution.** The groove is 1.2 mm wide and 0.86 mm deep, and the wedge tip is 0.5 mm; on a 0.4 mm nozzle that is two to three line widths. It may need a finer layer height or a slightly larger groove.']
    if fails:
        L += ['', '## CHECK FAILURES', *[f'- {f}' for f in fails]]
    open(os.path.join(HERE, 'HINGE.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
