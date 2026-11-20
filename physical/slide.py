#!/usr/bin/env python3
"""
The sliding arm: a two-stage telescoping dovetail slide under the piece's body.

Why this and not a plain bar or rail (measured in `arms.py`'s layout test, see SLIDE.md):
a fixed rail that stays out at full reach builds 3 of the game's 10 trees, a bar with a tail
builds 7, and a two-stage telescope builds all 10.

One arm is four printed parts and two screws:
    A    the fixed bar, screwed to the underside of the body; a dovetail tongue underneath
    S1   the middle slider: dovetail groove on top (A's tongue rides in it), a tongue underneath
    S2   the outer slider: groove on top (S1's tongue), and a FOOT that carries the child
    plug insert   the kit's keyed plug on a round shank that snaps into the foot (the key-specific part)
Each stage has two stops, in and out (0 or 36 mm), so the child hangs at 0, 36 or 72 mm out.
Left arms are the right arm turned 180 degrees about the vertical; one set of parts makes both.

Detent: one printed flexure beam per stage beside the dovetail, with a bump that drops into a
dimple at 'in' and at 'out'. The 'out' dimple has a steep far flank that doubles as the stop.
Retraction stops against the closed end of the groove.

Run from the repo root:  python3 physical/slide.py
"""
import json, math, os, sys
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon, box as tbox, cylinder
from trimesh.boolean import union, difference, intersection
from shapely.geometry import Polygon, box as sbox
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import coupon as C
import spokes as sp

OUT = os.path.join(HERE, 'hinge', 'slide')
os.makedirs(OUT, exist_ok=True)
ENGINE = 'manifold'

# ---- dimensions (mm) --------------------------------------------------------------------------
W = 14.0                 # width of a slider (z)
LAYER = 6.0              # base thickness of A, S1 and S2 (5 first; 6 after the strength check, see SLIDE.md)
LEN = 48.0               # length of A, S1, S2
STEP = 36.0              # travel of each stage
TD = 1.4                 # dovetail tongue depth
NECK = 3.0               # tongue neck width
HEAD = NECK + 2 * TD     # tongue head width (45 degree flanks)
CLR = 0.25               # groove clearance per side
GD = 1.6                 # groove depth (the flanks run parallel to the tongue's, CLR away)
VGAP = 0.3               # clear gap between stacked layers
TONG_LEN = 45.0          # tongue length
GROOVE_END = 45.7        # the groove is closed beyond this: the retract stop
ZC = 10.5                # the stack's centre line, off the piece's centre plane
FOOT_X = 40.0            # foot centre along the part
FOOT_W = 14.0            # foot width along the slide
DROP = 34.0              # body underside to the plug's base face (the child's top)
BORE_R = 3.8             # insert bore
SHANK_R = 3.7
FLAT = 2.9               # the bore and the shank are D-shaped: the flat is at +x of the bore's axis, so the insert cannot turn
WIDTH2 = 64.0            # a two-slot body is wider than the layout model's first guess, so A's groove has a closed end
_orig_body_width = A.body_width


def body_width(n):
    return WIDTH2 if n == 2 else _orig_body_width(n)


A.body_width = body_width
BORE_TOP = 24.0
# detent
BEAM_X0, BEAM_X1 = 1.5, 18.0      # flexure beam, along the slide (rooted at BEAM_X1)
BEAM_Z0, BEAM_Z1 = 4.6, 6.6       # across (the lane beside the dovetail)
SLIT_IN, SLIT_OUT = 4.1, 7.1
BEAM_T = 2.4
BUMP_X = 4.0
FLANK_DEG = 60.0                  # detent flank slope
BUMP_H = 0.7
BUMP_TOP_HALF = 0.6
BUMP_HALF = BUMP_TOP_HALF + BUMP_H / math.tan(math.radians(FLANK_DEG))   # half-length at the base
DIMPLE_D = 0.55                   # dimple depth
DIMPLE_FACE_HALF = 0.98           # dimple half-length at the face
OUT_FLANK_DEG = 70.0              # the far flank of the 'out' dimple: a stop

Y_A = VGAP                         # A hangs one layer gap below the body's underside (y = 0)
Y_S1 = Y_A + LAYER + VGAP          # 5.3
Y_S2 = Y_S1 + LAYER + VGAP         # 10.6
Y_S2_BOT = Y_S2 + LAYER            # 15.6


def prism_yz(pts, x0, x1):
    """pts are (y, z); runs along x from x0 to x1."""
    m = extrude_polygon(Polygon(pts), x1 - x0, engine='earcut')       # (u, v, w) = (y, z, x)
    m.apply_transform(np.array([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1.0]]))   # x = w, y = u, z = v
    m.apply_translation([x0, 0, 0])
    return H.fix(m)


def prism_xy(pts, z0, z1):
    m = extrude_polygon(Polygon(pts), z1 - z0, engine='earcut')
    m.apply_translation([0, 0, z0])
    return H.fix(m)


def tongue(y0, x0=0.0, x1=None):
    x1 = TONG_LEN if x1 is None else x1
    return prism_yz([(y0 - 0.01, -NECK / 2), (y0 - 0.01, NECK / 2), (y0 + TD, HEAD / 2), (y0 + TD, -HEAD / 2)], x0, x1)


def groove(y0, x0=-1.0, x1=None):
    x1 = GROOVE_END if x1 is None else x1
    hm = NECK / 2 + VGAP + CLR                   # mouth half width: the tongue's flank, one layer gap and CLR away
    return prism_yz([(y0 - 0.5, -hm), (y0 - 0.5, hm), (y0, hm), (y0 + GD, hm + GD), (y0 + GD, -(hm + GD)), (y0, -hm)], x0, x1)


def bump(xc, y_face, up, z0, z1):
    """The detent bump on a beam; `up` = +1 if it rises toward smaller y (top face), -1 if toward larger y."""
    s = -1.0 if up > 0 else 1.0
    pts = [(xc - BUMP_HALF, y_face - s * 0.01), (xc + BUMP_HALF, y_face - s * 0.01),
           (xc + BUMP_TOP_HALF, y_face + s * BUMP_H), (xc - BUMP_TOP_HALF, y_face + s * BUMP_H)]
    return prism_xy(pts, z0, z1)


def dimple(xc, y_face, toward, z0, z1, steep):
    """A dimple cut into the face at y_face (into smaller y if toward < 0). The far flank (the +x side, the way
    the slider leaves) is steeper for the 'out' dimple: that is the stop."""
    s = 1.0 if toward > 0 else -1.0
    near = DIMPLE_D / math.tan(math.radians(FLANK_DEG))
    far = DIMPLE_D / math.tan(math.radians(OUT_FLANK_DEG if steep else FLANK_DEG))
    f = DIMPLE_FACE_HALF
    pts = [(xc - f, y_face - s * 0.01), (xc + f, y_face - s * 0.01), (xc + f - far, y_face + s * DIMPLE_D), (xc - f + near, y_face + s * DIMPLE_D)]
    return prism_xy(pts, z0, z1)


def flexure_cut(y_top, y_bot, side, pocket_from):
    """Slits and an under-pocket that free a cantilever beam in the lane at z of sign `side`.
    The beam is BEAM_T thick, rooted at x = BEAM_X1; pocket_from is the y where the pocket starts (beam underside)."""
    s = side
    def zr(a, b): return (min(s * a, s * b), max(s * a, s * b))
    cuts = []
    for (za, zb, xa, xb) in [(SLIT_IN, BEAM_Z0, BEAM_X0 - 0.5, BEAM_X1), (BEAM_Z1, SLIT_OUT, BEAM_X0 - 0.5, BEAM_X1), (SLIT_IN, SLIT_OUT, BEAM_X0 - 1.0, BEAM_X0)]:
        z0, z1 = zr(za, zb)
        cuts.append(H.slab(xa, xb, y_top - 1.0, y_bot + 1.0, z0, z1))
    z0, z1 = zr(SLIT_IN, SLIT_OUT)
    cuts.append(H.slab(BEAM_X0 - 1.0, BEAM_X1, pocket_from, y_bot + 1.0, z0, z1))
    return cuts


def d_prism(r, y0, y1, x=0.0, z=0.0, flat=FLAT):
    """A cylinder of radius r along y from y0 to y1 with a flat on its +x side (a D), centred at (x, z)."""
    from shapely.geometry import Point
    poly = Point(0, 0).buffer(r, 48).intersection(sbox(-r - 1, -r - 1, flat * r / BORE_R, r + 1))
    m = extrude_polygon(poly, y1 - y0, engine='earcut')        # local (x, y_l, z_l); rot_x(90) turns y_l into z and z_l into -y
    m.apply_transform(H.rot_x(90))
    m.apply_translation([x, y1, z])
    return H.fix(m)



def part_A():
    """The fixed bar. It slides into a dovetail groove under the body from the outer side (no screws) and a
    detent beam on its top face clicks into a dimple in the body; its underside carries the groove for S1."""
    base = H.slab(0, LEN, Y_A, Y_A + LAYER, -W / 2, W / 2)
    tg = tongue(Y_A + LAYER)
    top = prism_yz([(Y_A + 0.02, -NECK / 2), (Y_A + 0.02, NECK / 2), (Y_A - TD, HEAD / 2), (Y_A - TD, -HEAD / 2)], 0.0, LEN)       # points up, into the body
    z0, z1 = -BEAM_Z1, -BEAM_Z0
    bmp = bump(BUMP_X, Y_A, +1, z0, z1)
    cuts = flexure_cut(Y_A, Y_A + LAYER, -1, Y_A + BEAM_T)
    cuts.append(dimple(BUMP_X, Y_A + LAYER, -1, BEAM_Z0, BEAM_Z1, False))               # S1's beam, in the +z lane
    cuts.append(dimple(BUMP_X + STEP, Y_A + LAYER, -1, BEAM_Z0, BEAM_Z1, True))
    return H.fix(difference([union([base, tg, top, bmp], engine=ENGINE)] + cuts, engine=ENGINE))


def slider(y_top, with_tongue, lane_beam_side, lane_dimple_side, foot=False):
    """S1 (with a tongue underneath) or S2 (with a foot)."""
    y_bot = y_top + LAYER
    base = H.slab(0, LEN, y_top, y_bot, -W / 2, W / 2)
    parts = [base]
    cuts = [groove(y_top)]
    s = lane_beam_side
    cuts += flexure_cut(y_top, y_bot, s, y_top + BEAM_T)
    if with_tongue:
        parts.append(tongue(y_bot))
        z0, z1 = sorted((lane_dimple_side * BEAM_Z0, lane_dimple_side * BEAM_Z1))
        cuts.append(dimple(BUMP_X, y_bot, -1, z0, z1, False))
        cuts.append(dimple(BUMP_X + STEP, y_bot, -1, z0, z1, True))
    z0, z1 = sorted((s * BEAM_Z0, s * BEAM_Z1))
    parts.append(bump(BUMP_X, y_top, +1, z0, z1))
    if foot:
        fz0, fz1 = -ZC - 7.0, 7.0
        parts.append(H.slab(FOOT_X - FOOT_W / 2, FOOT_X + FOOT_W / 2, y_bot, DROP, fz0, fz1))
        parts.append(H.slab(FOOT_X - FOOT_W / 2, FOOT_X + FOOT_W / 2, y_bot - 0.02, y_bot + 0.02, -W / 2, W / 2))   # a sliver of overlap so the union fuses
        cuts.append(d_prism(BORE_R, BORE_TOP, DROP + 0.5, FOOT_X, -ZC))
        ring = cylinder(radius=BORE_R + 0.45, height=1.2, sections=48); ring.apply_transform(H.rot_x(90))
        ring.apply_translation([FOOT_X, BORE_TOP + 4.6, -ZC]); cuts.append(ring)
    return H.fix(difference([union(parts, engine=ENGINE)] + cuts, engine=ENGINE))


def part_S1():
    return slider(Y_S1, True, +1, -1)


def part_S2():
    return slider(Y_S2, False, -1, 0, foot=True)


def part_insert(geo, code, turn=0.0):
    """The keyed plug on a D-shaped shank with a snap ring; the plug's base is at y = DROP. `turn` turns the plug
    about its own axis relative to the shank's flat: a left arm is the right arm turned 180 degrees, so its
    insert is made with the plug turned 180 degrees and the plug points the same way in the finished piece."""
    shank = d_prism(SHANK_R, BORE_TOP, DROP, 0.0, 0.0, flat=FLAT - 0.15)
    ring = cylinder(radius=BORE_R + 0.25, height=0.9, sections=48); ring.apply_transform(H.rot_x(90))
    ring.apply_translation([0, BORE_TOP + 4.6, 0])
    plug = C.plug_solid(geo, code)
    plug.apply_transform(H.rot_x(90))                       # tip toward +y
    plug.apply_translation([0, DROP + C.PLUG_LEN, 0])
    if turn:
        plug.apply_transform(H.rot_y(turn))
    m = H.fix(union([shank, ring, plug], engine=ENGINE))
    m.apply_translation([FOOT_X, 0, -ZC])
    return m


def body_stub(n_slots=3):
    """What the underside of the body must carry for the two arms of a three-slot piece: a dovetail groove for each
    (open on its own outer side, closed at the inner end) and a dimple for A's latch."""
    w = A.body_width(n_slots)
    b = H.slab(-w / 2, w / 2, -A.BODY_H, 0.0, -ZC - 7.0, ZC + 7.0)           # 35 mm thick
    hm = NECK / 2 + VGAP + CLR
    cuts = []
    for left in (False, True):
        g = prism_yz([(0.5, -hm), (0.5, hm), (0.0, hm), (-GD, hm + GD), (-GD, -(hm + GD)), (0.0, -hm)], -24.3, w / 2 + 1.0)
        g.apply_translation([0, 0, ZC])
        d = dimple(-24.0 + BUMP_X, 0.0, -1, ZC - BEAM_Z1, ZC - BEAM_Z0, False)
        if left:
            g.apply_transform(H.rot_y(180)); d.apply_transform(H.rot_y(180))
        cuts += [g, d]
    return H.fix(difference([b] + cuts, engine=ENGINE))


def at(m, x=0.0, y=0.0, z=0.0):
    m = m.copy(); m.apply_translation([x, y, z]); return m


def assembly(parts, s1, s2, left=False, x0=-24.0):
    """The right arm of a three-slot piece (A's inner end at x0, carriage retracted under px = +16),
    or the left arm (turned 180 degrees about the vertical). s1, s2 = 0 or STEP."""
    Aa, S1, S2, ins = parts
    out = [at(Aa, x0, 0, ZC), at(S1, x0 + s1, 0, ZC), at(S2, x0 + s1 + s2, 0, ZC), at(ins, x0 + s1 + s2, 0, ZC)]
    if left:
        R = H.rot_y(180)
        out = [m.copy() for m in out]
        for m in out: m.apply_transform(R)
    return out


# ---------------------------------------------------------------- analysis helpers
DENS, FILL = 1.27e-3, 0.5                  # g/mm3 PETG, effective fill (the same assumption as swivel_loads.py)
E_PETG = 1500.0
SIG, ENDUR, TAU = 20.0, 12.0, 12.0         # MPa: bending, repeated flexing, shear
MU = (0.0, 0.3, 0.45)
G = H.G


def section_yz(m, x):
    """The mesh cut by the plane at x, as a shapely shape in (y, z). Tries a few nearby x if a cut lands on an edge."""
    for dx in (0.0, 0.13, -0.13, 0.31, -0.31):
        sh = _section_yz(m, x + dx)
        if sh.area > 1.0: return sh
    raise ValueError('empty section')


def _section_yz(m, x):
    from shapely.geometry import LineString
    from shapely.ops import polygonize
    segs = trimesh.intersections.mesh_plane(m, [1, 0, 0], [x, 0, 0])
    r = lambda v: round(float(v), 5)
    lines = [LineString([(r(p[0][1]), r(p[0][2])), (r(p[1][1]), r(p[1][2]))]) for p in segs]
    return unary_union(list(polygonize(unary_union(lines))))


def modulus(shape):
    """Section modulus for bending in the x-y plane (stress along x): I about the z axis through the centroid / farthest y."""
    h = 0.05
    minx, miny, maxx, maxy = shape.bounds
    ys = np.arange(minx + h / 2, maxx, h); zs = np.arange(miny + h / 2, maxy, h)     # shapely x = our y, shapely y = our z
    from shapely import contains_xy
    Y, Z = np.meshgrid(ys, zs, indexing='ij')
    inside = contains_xy(shape, Y, Z)
    area = inside.sum() * h * h
    yc = (Y[inside]).mean()
    I = ((Y[inside] - yc) ** 2).sum() * h * h
    c = max(yc - Y[inside].min(), Y[inside].max() - yc)
    return I / c, area


def detent(mu, flank=FLANK_DEG, stiff=1.0):
    """The force to push a slider out of a detent: a cantilever beam with a bump on a wedge flank."""
    b, t = BEAM_Z1 - BEAM_Z0, BEAM_T
    L = BEAM_X1 - BUMP_X
    k = 3 * E_PETG * (b * t ** 3 / 12) / L ** 3
    delta = BUMP_H - VGAP
    fn = k * delta
    tn = math.tan(math.radians(flank))
    f = fn * (tn + mu) / (1 - mu * tn) if mu * tn < 1 else float('inf')
    sigma = 6 * fn * L / (b * t * t)
    return dict(k=k, delta=delta, normal=fn, force=f, sigma=sigma, L=L)


def direction(slot, n):
    return -1 if slot == 0 else (1 if slot == n - 1 else 0)


def telescope_beam(inboard, outer, h):
    """The arm's outline for the layout test: from A's inner end to the carriage's far edge, the stack's height."""
    from shapely.geometry import box as sb
    def fn(px, py, ex, slot, ns):
        s = direction(slot, ns)
        if s == 0:
            return sb(px - FOOT_W / 2, py, px + FOOT_W / 2, py + h)
        d = abs(ex - px)
        a, b = px - s * inboard, px + s * (d + outer)
        return sb(min(a, b), py, max(a, b), py + h)
    return fn


def slide_design(step=STEP, npos=2):
    left = A.slide_settings([-step * i for i in range(npos + 1)])
    right = A.slide_settings([step * i for i in range(npos + 1)])
    D = {1: A.STUB, 2: right, 3: right}
    for ns in (2, 3):
        D[(ns, 0)] = left; D[(ns, ns - 1)] = right
    D[(3, 1)] = A.slide_settings([0])
    return D


def verify(parts):
    """Independent distance check on a finished layout (parts from arms.layout): bodies, the arms' outlines
    (beam out to the carriage plus the stack's inboard end) and stems must all keep GAP clear of anything they
    are not attached to. Conservative: arms of different pieces are treated as sharing one plane."""
    import itertools
    bodies = {i[1]: (g, i[0]) for k, g, i in parts if k == 'body'}
    stems = [(g, i) for k, g, i in parts if k == 'stem']
    beams = [(g, i) for k, g, i in parts if k == 'beam']
    bad = []
    for a, b in itertools.combinations(bodies, 2):
        if bodies[a][0].distance(bodies[b][0]) < A.GAP - 0.01: bad.append('two bodies too close')
    for g, (t, slot, pu, cu) in stems:
        for uid, (bg, _) in bodies.items():
            if uid not in (pu, cu) and g.distance(bg) < A.GAP - 0.01: bad.append('a stem too close to a body')
    for g, (t, slot, pu, cu) in beams:
        for uid, (bg, _) in bodies.items():
            if uid != pu and g.distance(bg) < A.GAP - 0.01: bad.append('an arm too close to a body')
    for (g1, i1), (g2, i2) in itertools.combinations(stems, 2):
        if g1.distance(g2) < A.GAP - 0.01: bad.append('two stems too close')
    for (g1, i1), (g2, i2) in itertools.combinations(beams, 2):
        if i1[2] != i2[2] and g1.distance(g2) < A.GAP - 0.01: bad.append('two arms of different pieces too close')
    for g1, i1 in beams:
        for g2, i2 in stems:
            if i1[2] != i2[2] and i2[3] != i1[2] and g1.distance(g2) < A.GAP - 0.01: bad.append('an arm too close to another stem')
    return bad


def overlap(a, b):
    if not a.bounds[0].shape and False: return 0.0
    ba, bb = a.bounds, b.bounds
    if (ba[1] < bb[0]).any() or (bb[1] < ba[0]).any(): return 0.0
    try:
        r = intersection([a, b], engine=ENGINE)
        return float(r.volume) if len(r.faces) else 0.0
    except Exception:
        return float('nan')


def child_block(x, w=30.0, h=26.0, d=24.0):
    """A block with the kit's plug socket, hanging from the plug's base face."""
    b = tbox(extents=[w, h, d]); b.apply_translation([x, DROP + h / 2, 0])
    cav = cylinder(radius=11.9, height=C.PLUG_LEN + 0.6, sections=64); cav.apply_transform(H.rot_x(90))
    cav.apply_translation([x, DROP + (C.PLUG_LEN + 0.6) / 2 - 0.3, 0])
    return H.fix(difference([b, cav], engine=ENGINE))


# ---------------------------------------------------------------- figures
COL = {'A': '#7a8fa6', 'S1': '#3f9c8f', 'S2': '#e08a3c', 'ins': '#33415c', 'body': '#d9dde3', 'post': '#9aa3ad'}


def polys_at(m, normal, origin):
    from shapely.geometry import LineString
    from shapely.ops import polygonize
    segs = trimesh.intersections.mesh_plane(m, normal, origin)
    ax = [i for i in range(3) if normal[i] == 0]
    if normal[0] == 1: ax = [2, 1]                      # across the piece: z to the right, y down
    r = lambda v: round(float(v), 4)
    lines = [LineString([(r(p[0][ax[0]]), r(p[0][ax[1]])), (r(p[1][ax[0]]), r(p[1][ax[1]]))]) for p in segs]
    return unary_union(list(polygonize(unary_union(lines)))) if lines else None


def fill(ax, shp, color, **kw):
    if shp is None or shp.is_empty: return
    for p in (shp.geoms if hasattr(shp, 'geoms') else [shp]):
        if p.geom_type != 'Polygon': continue
        ax.fill(*p.exterior.xy, color=color, lw=0.5, ec='#222', **kw)
        for h in p.interiors: ax.fill(*h.xy, color='white', lw=0.5, ec='#222')


def figure_sections(P, stub, post, path):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig, axes = plt.subplots(3, 1, figsize=(11, 10.5), facecolor='white')
    for ax, (s1, s2), title in zip(axes, [(0, 0), (STEP, 0), (STEP, STEP)], ['both stages in: the child hangs under the slot (0 mm out)', 'stage 1 out: 36 mm', 'both stages out: 72 mm']):
        Rm = assembly(P, s1, s2, False)
        fill(ax, polys_at(stub, [0, 0, 1], [0, 0, ZC]), COL['body'], alpha=0.9)
        for m, k in zip(Rm[:3], ['A', 'S1', 'S2']):
            fill(ax, polys_at(m, [0, 0, 1], [0, 0, ZC - 5.6]), COL[k])        # through the detent lane
            fill(ax, polys_at(m, [0, 0, 1], [0, 0, ZC]), COL[k], alpha=0.85)
        cx = 16.0 + s1 + s2
        fill(ax, polys_at(Rm[2], [0, 0, 1], [0, 0, 0.0]), COL['S2'])
        fill(ax, polys_at(Rm[3], [0, 0, 1], [0, 0, 0.0]), COL['ins'])
        ch = child_block(cx)
        fill(ax, polys_at(ch, [0, 0, 1], [0, 0, 0.0]), '#f3e3b0', alpha=0.9)
        ax.annotate('', xy=(cx, DROP + 40), xytext=(16.0, DROP + 40), arrowprops=dict(arrowstyle='<->', color='#444'))
        ax.text((cx + 16) / 2, DROP + 36, f'{s1 + s2:.0f} mm', ha='center', fontsize=10, color='#333')
        ax.set_aspect('equal'); ax.invert_yaxis(); ax.set_xlim(-45, 125); ax.set_ylim(DROP + 48, -30)
        ax.set_title(title, fontsize=12, loc='left'); ax.axis('off')
    fig.suptitle('The right arm of a three-slot piece, cut along the slide (y down). Grey: the body\'s underside; blue-grey A, green S1, orange S2, navy the plug insert, cream the child.', fontsize=10, y=0.995)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def figure_cross(P, stub, post, path):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(11, 5.2), facecolor='white')
    for ax, x, title in zip(axes, (0.0, 24.0 - 12.0), ['across the piece at the centre line (x = 0)', 'across the piece 12 mm toward the right arm\'s foot']):
        fill(ax, polys_at(stub, [1, 0, 0], [x, 0, 0]), COL['body'], alpha=0.9)
        for left in (False, True):
            ms = assembly(P, 0, 0, left)
            for m, k in zip(ms, ['A', 'S1', 'S2', 'ins']):
                fill(ax, polys_at(m, [1, 0, 0], [x, 0, 0]), COL[k])
        fill(ax, polys_at(post, [1, 0, 0], [x, 0, 0]), COL['post'])
        ax.set_aspect('equal'); ax.invert_yaxis(); ax.set_xlim(-24, 24); ax.set_ylim(DROP + 14, -A.BODY_H - 4)
        ax.set_title(title, fontsize=11, loc='left'); ax.axis('off')
    fig.suptitle('Both arms side by side in z, the fixed middle post between them (horizontal: z, vertical: y down)', fontsize=10)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def figure_parts(P, path):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    ms = []
    for m, dy in zip(P, [0, 42, 84, 140]):
        mm = m.copy(); mm.apply_translation([-m.bounds.mean(axis=0)[0] * 0, dy, 0]); ms.append(mm)
    combined = trimesh.util.concatenate(ms)
    img = C.render(combined, w=900, h=640, elev=34, azim=-62)
    fig, ax = plt.subplots(figsize=(9, 6.4), facecolor='white'); ax.imshow(img); ax.axis('off')
    ax.set_title('A, S1, S2 and the plug insert, apart', fontsize=11, loc='left')
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def figure_trees(res, uniq, path, names):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    from shapely.geometry import box as sb
    fig, axes = plt.subplots(1, len(names), figsize=(6.2 * len(names), 7.6), facecolor='white')
    for ax, nm in zip(np.atleast_1d(axes), names):
        parts = next(p for n, o, p in res if n == nm)
        for k, g, i in parts:
            if k not in ('body', 'beam', 'stem'): continue
            col = {'body': '#d9dde3', 'beam': '#e08a3c', 'stem': '#33415c'}[k]
            fill(ax, g, col)
        ax.set_aspect('equal'); ax.invert_yaxis(); ax.axis('off')
        w, h = A.extents(parts); ax.set_title(f'{nm}\n{w:.0f} x {h:.0f} mm', fontsize=10, loc='left')
    fig.suptitle('Layouts with the real arm outlines: orange = the telescope stack (its inboard end under the body to the carriage), navy = the foot', fontsize=10)
    fig.tight_layout(); fig.savefig(path, dpi=110); plt.close(fig)


def write_doc(R, path):
    v = R['variants']; L = R['layout']; D = R['detent']; M = R['mass']; st = R['loads']['stress']; g = R['loads']['grams']
    hv = R['hold_cover_vertical_by_mu']
    f = lambda e: f'{e[0]:.0f} × {e[1]:.0f}' if e else 'cannot build'
    rows = []
    for n, d in R['sizes'].items():
        rows.append(f'| {n.replace(":", " · ")} | {f(d.get("swivel"))} | {f(d["slide"])} |')
    out = f"""# The sliding arm

Generated by `physical/slide.py`. Parts: `physical/hinge/slide/`. Figures: `sections.png`, `cross.png`, `parts.png`, `trees.png` in the same folder.

The swinging arm needed a hinge cartridge and a swivel cartridge on every arm (`SWIVEL.md`): about 34 g per arm, 16 screws, and the biggest X′ tree still could not be built. This replaces both with an arm that slides sideways, so the child hangs straight down at every setting and nothing has to keep it upright.

## Which kind of slide

`ARM_OPTIONS.md` found that a sliding arm builds all 10 of the game's trees, but only drew the beam out to the carriage. A real slide has a part that stays behind, so I measured three real outlines with the same layout test (arm 15 mm tall, 72 mm reach, child 34 mm below the body):

| Slide | Trees built | Widest tree | Tallest tree |
|---|---|---|---|
""" + "\n".join(f"| {x['label']} | **{x['builds']} of {x['of']}** | {x['widest']:.0f} mm | {x['tallest']:.0f} mm |" for x in v) + f"""

A rail that stays out at full reach pokes into its neighbours at its own height in 7 of the 10 trees; a single bar with a tail that sticks out the far side fails 3. **A two-stage telescope** keeps everything that is not needed inside the body's width (all but its inboard end, which sits under the body), and builds all ten, with {L['problems']} problems found by an independent distance check of the finished layouts.

## How it works

Each moving arm is **four printed parts and no screws**. A two-slot or three-slot piece has two moving arms (left and right), turned 180° from each other so one set of parts makes both; a three-slot piece's middle slot is a fixed post.

| Part | What it is |
|---|---|
| `slide_A.stl` | the **fixed bar**. It has a dovetail along its top that slides into a groove under the body *from the outer side*, and a latch beam that clicks into a dimple; to take an arm off, pull it out sideways (about {D['force']['0.3']:.0f} N). Underneath, a dovetail tongue for S1 |
| `slide_S1.stl` | the **middle slider**: a groove on top for A's tongue, a tongue underneath for S2, and a detent beam |
| `slide_S2.stl` | the **outer slider**: a groove on top for S1's tongue, a detent beam, and the **foot**, a block that jogs sideways to the piece's centre plane and holds the plug insert |
| `slide_insert.stl` | the **keyed plug** on a round shank that snaps into the foot (here the key for a DP). The insert is the only key-specific part (its snap-in retention is not analysed), so a kit needs 26 inserts, not 26 arms |
| `slide_body_stub.stl` | *reference only*: what the underside of a three-slot body needs (the two dovetail grooves and the two latch dimples). The body itself is not designed yet |

Dimensions: each slider is 14 mm wide and 48 mm long with a 6 mm base; the dovetail has a 3.0 mm neck, 5.8 mm head and is 1.4 mm deep, with 0.25 mm clearance; the three bases together stack {Y_S2_BOT:.0f} mm below the body. Each stage has **two stops, in and out (36 mm apart)**, so the child hangs **0, 36 or 72 mm** from its slot. The plug's base face is 34 mm below the body.

![sections](sections.png)

![across the piece](cross.png)

The left and right stacks sit side by side in z (their centre lines 21 mm apart), with the fixed middle post between them, so **every two- and three-slot body is 35 mm thick** (heads, bars and one-slot pieces are 30 mm thick; the plug is always at the centre plane). **A two-slot body is 64 mm wide**, so each arm's inboard end stays inside it and the groove can be closed; `BODY.md` has the bodies.

![parts](parts.png)

**Detent.** Each stage has a printed flexure beam in the strip beside the dovetail: a {D['beam_L']:.0f} mm cantilever 2.0 × 2.4 mm with a 0.7 mm bump with 60° flanks that drops into a dimple at *in* and at *out*. Retracting stops against the closed end of the groove; the *out* dimple has a steeper far flank (70°) that acts as the stop. The force to push a stage out of a stop is **{D['force']['0.0']:.1f} / {D['force']['0.3']:.1f} / {D['force']['0.45']:.1f} N** for friction 0 / 0.3 / 0.45; the stop on the far side is about {D['out_stop']:.0f} N at friction 0.3. The beam's bending stress when it rides over the bump is {D['sigma']:.0f} MPa, right at the repeated-flexing limit I used for PETG (12 MPa), so it should be treated as a wear part.

## What the script checked on the real meshes

- All four parts are watertight solids.
- **{R['poses']} combinations of settings** for the right and left arm of a three-slot piece (each stage in or out, both arms): no part overlaps any other, the body, the middle post, or the child's block hanging below the plug (largest overlap {R['worst_overlap']:.3f} mm³).
- The plug ends up **0, 36 and 72 mm** from rest (measured on the meshes), and the plug always points straight down.
- **Detents:** seated at every stop with no overlap, and pressing in with {R['detent_overlap']['between'][0]:.2f} mm³ half-way between the stops, so the bump really does ride on the face. The arm's mount latch behaves the same way.

## Loads

The weights come from the same 10 trees laid out with this arm, with real masses: one arm {M['arm']:.1f} g (A {M['arm'] - M['S1'] - M['S2_ins']:.1f}, S1 {M['S1']:.1f}, S2 with foot and plug {M['S2_ins']:.1f}), a head {M['pieces'][0]:.0f} g, a one-slot piece {M['pieces'][1]:.0f} g, a two-slot piece {M['pieces'][2]:.0f} g and a three-slot piece {M['pieces'][3]:.0f} g (bodies and arms; masses from {M['source']}), at 50% fill in PETG. The weight hanging from one of the {R['loads']['n_arms']} moving arms: median {g['median']:.0f} g, 90th percentile {g['p90']:.0f} g, largest {g['max']:.0f} g. Stress is at the weakest section of the stage that carries most (S1 where A's tongue ends), at full extension:

| Hanging weight | S1 bending | S2 bending | Tongue shear | Dovetail twist (from the foot's 10.5 mm offset) |
|---|---|---|---|---|
""" + "\n".join(f"| {k} ({v_['grams']:.0f} g) | {v_['S1']:.1f} MPa (safety {20 / v_['S1']:.1f}) | {v_['S2']:.1f} MPa (safety {20 / v_['S2']:.1f}) | {v_['tongue_shear']:.1f} MPa (safety {12 / v_['tongue_shear']:.1f}) | {v_['twist_flank']:.1f} N per flank |" for k, v_ in st.items()) + f"""

(The *abuse* row is a hand pulling down 15 N on the carriage, the same shove used in `FORTIFY.md`.) A base of 5 mm gave a safety factor of 0.9 at that shove, so **the layers are 6 mm** and the stack is 1 mm taller; the safety factor is now **1.3**, still the first place I would look for a break.

**Holding.** Along the slide, a stage has to resist the weight of everything below it only if the slide is tilted. With the slide pointing *straight down* (the worst case, which a phrase held by its top piece never reaches), a stage holds **{hv['0.0']:.0f}% / {hv['0.3']:.0f}% / {hv['0.45']:.0f}%** of the arms at friction 0 / 0.3 / 0.45. At friction 0.3 the heaviest arms are beyond what a stage holds pointing straight down: the push-out force is {D['force']['0.3']:.1f} N and the heaviest phrase weighs {(g['max'] + M['S1'] + M['S2_ins']) * 9.81e-3:.1f} N. Held at 60° from level the stage holds {R['hold_cover']['60']:.0f}% of the arms. The lever is the body's weight (`BODY.md`): lower infill or hollowing, or a stronger detent, both raise the share. **Friction is the number I cannot calculate**: it is the first thing to measure on a printed coupon.

## Layouts

{L['built']} of {L['of']} trees build with this arm (`trees.png` shows the biggest X′ tree, which the swivel cartridge could not build, and a typical one). Sizes in mm, against the swivel cartridge from `SWIVEL.md`:

| Tree | swinging arm with swivel | **sliding arm (this design)** |
|---|---|---|
""" + "\n".join(rows) + f"""

![trees](trees.png)

**Unused arms.** With the real outline, leaving the unused arm on works for only {L['parked']} of the {L['of']} trees, so an unused arm should be taken off: pull it out sideways. That replaces the whole stowing problem of `STOW.md` with one gesture and no tool.

## Compared with the swivel

| | swinging arm + swivel | **sliding arm** |
|---|---|---|
| Printed parts per arm | 8 (two housings, two hubs, four lids; the arm bar is part of one housing) | **4** |
| Screws per arm | 16 | **0** |
| Mass of one arm | about 34 g | **{M['arm']:.1f} g** |
| Child upright? | only if twisted back at every setting | **always** |
| Trees built | 9 of 10 | **{L['built']} of {L['of']}** |
| Settings | 5 angles, then a second setting | 3 distances, two stops each |
| Body thickness | 24 mm | **35 mm** (slotted pieces), 30 mm (others) |

## What this does not settle

- **Nothing has been printed.** The clearances (0.25 mm), the 0.4 mm detent engagement and the friction are all assumptions; the first print should be a short coupon of A, S1 and S2 at 1/3 length to tune them.
- **The bodies are designed in `BODY.md`** (the stub here is only the underside of a three-slot one).
- **Print orientation** (a suggestion): each slider lying on one of its 14 mm faces, so the dovetail flanks are 45° overhangs, the layer lines run along the beam and the flexure beams bend within a layer.
- The model of the loads ignores dynamic effects (dropping a phrase) and a real shove sideways (z); the foot's jog gives a twist on the dovetail that is small but not checked on a print.
- The foot is solid and heavy (7.6 g with the plug); a ribbed foot would save about 2 g per arm.
"""
    open(path, 'w').write(out)


# ---------------------------------------------------------------- main
def main():
    import itertools, statistics
    from collections import defaultdict
    cats, modes, types, keys, accepts, cfg, asg = sp.design()
    geo = sp.Spokes(cfg); code = asg[frozenset({'D1'})]
    R = {}
    print('== building the parts')
    P = [part_A(), part_S1(), part_S2(), part_insert(geo, code)]
    names = ['A', 'S1', 'S2', 'insert']
    stub = body_stub(3)
    health = {}
    for n, m in zip(names, P):
        assert m.is_watertight, n
        health[n] = dict(mm3=float(m.volume), bounds=m.bounds.round(2).tolist())
        m.export(os.path.join(OUT, f'slide_{n}.stl'))
        print(f'   {n:<7} watertight, {m.volume:8.0f} mm3, {np.ptp(m.bounds, axis=0).round(1).tolist()} mm')
    stub.export(os.path.join(OUT, 'slide_body_stub.stl'))
    R['health'] = health

    print('== every setting of both arms of a three-slot piece, on the real meshes')
    post = H.slab(-6, 6, 0, DROP, -3.0, 3.0)
    worst, engaged, nposes = 0.0, [], 0
    carriage = {}
    for (r1, r2) in [(0, 0), (STEP, 0), (0, STEP), (STEP, STEP)]:
        for (l1, l2) in [(0, 0), (STEP, 0), (0, STEP), (STEP, STEP)]:
            Rm = assembly(P, r1, r2, False); Lm = assembly(P, l1, l2, True)
            allm = Rm + Lm + [stub, post]
            nm = ['R.A', 'R.S1', 'R.S2', 'R.ins', 'L.A', 'L.S1', 'L.S2', 'L.ins', 'body', 'post']
            for (i, a), (j, b) in itertools.combinations(list(enumerate(allm)), 2):
                v = overlap(a, b)
                if not (v == 0.0):
                    print(f'   OVERLAP {nm[i]}/{nm[j]} {v:.3f} mm3 at R{(r1, r2)} L{(l1, l2)}')
                    worst = max(worst, v if v == v else 1e9)
            nposes += 1
            if (l1, l2) == (0, 0):
                cx = Rm[3].bounds.mean(axis=0)[0]
                carriage[(r1, r2)] = float(cx)
            # the child hanging below each arm
            for arm, ms in (('R', Rm), ('L', Lm)):
                cx = ms[3].bounds.mean(axis=0)[0]
                ch = child_block(cx)
                for i, a in enumerate(ms[:3] + [stub, post] + (Lm if arm == 'R' else Rm)[:3]):
                    v = overlap(ch, a)
                    if v != 0.0:
                        print(f'   CHILD overlap {arm} {v:.3f}'); worst = max(worst, v)
                v = overlap(ch, ms[3])
                if v != 0.0: print(f'   child/plug overlap {v:.3f}'); worst = max(worst, v)
    print(f'   {nposes} combined settings checked: largest overlap {worst:.3f} mm3')
    R['poses'] = nposes; R['worst_overlap'] = worst
    cs = {k: round(v - carriage[(0, 0)], 2) for k, v in carriage.items()}
    print(f'   plug position out from rest (stage 1, stage 2): {cs}')
    R['reach'] = {f'{a}/{b}': v for (a, b), v in cs.items()}
    # detent: engaged between the stops, free at the stops
    mid = assembly(P, STEP / 2, 0)
    eng1 = overlap(mid[0], mid[1])
    mid = assembly(P, 0, STEP / 2)
    eng2 = overlap(mid[1], mid[2])
    seat1 = overlap(*[assembly(P, STEP, 0)[i] for i in (0, 1)]); seat2 = overlap(*[assembly(P, 0, STEP)[i] for i in (1, 2)])
    print(f'   detent: seated {seat1:.3f} / {seat2:.3f} mm3; half way between the stops {eng1:.2f} / {eng2:.2f} mm3 (the bump pressing into the face)')
    R['detent_overlap'] = dict(seated=[seat1, seat2], between=[eng1, eng2])
    pulled = assembly(P, 0, 0); pm = [m.copy() for m in pulled]
    for m in pm: m.apply_translation([STEP / 4, 0, 0])
    mount_between = overlap(pm[0], stub)
    seated_mount = overlap(*[assembly(P, 0, 0)[0], stub])
    print(f'   arm mount (A in the body groove): seated {seated_mount:.3f} mm3; pulled 9 mm out of the body {mount_between:.2f} mm3 (its latch pressing in)')
    R['mount'] = dict(seated=seated_mount, between=mount_between)
    assert mount_between > 0 and seated_mount == 0
    assert eng1 > 0 and eng2 > 0 and seat1 == 0 and seat2 == 0 and worst == 0.0, 'MECHANISM CHECK FAILED'

    # ------------------------------------------------------------ strength
    print('== strength')
    tl = TONG_LEN
    eng = tl - STEP                                           # tongue still in the groove at full extension
    xc_full = FOOT_X + 2 * STEP
    Z1_beam, a1 = modulus(section_yz(P[1], 9.0)); Z1_full, _ = modulus(section_yz(P[1], 30.0))
    Z2_beam, a2 = modulus(section_yz(P[2], 9.0)); Z2_full, _ = modulus(section_yz(P[2], 30.0))
    dt = {mu: detent(mu) for mu in MU}
    dt_out = detent(0.3, OUT_FLANK_DEG)
    print(f'   engaged length at full extension {eng:.0f} mm; section moduli (mm3): S1 at the beam {Z1_beam:.0f}, S1 plain {Z1_full:.0f}; S2 at the beam {Z2_beam:.0f}, S2 plain {Z2_full:.0f}')
    print(f'   detent: beam {dt[0.3]["L"]:.0f} mm long, k {dt[0.3]["k"]:.1f} N/mm, normal {dt[0.3]["normal"]:.2f} N at the bump, bending stress {dt[0.3]["sigma"]:.1f} MPa; push-out force {dt[0.0]["force"]:.1f} / {dt[0.3]["force"]:.1f} / {dt[0.45]["force"]:.1f} N (mu 0 / 0.3 / 0.45); out stop {dt_out["force"]:.0f} N')
    R['detent'] = dict(beam_L=dt[0.3]['L'], k=dt[0.3]['k'], normal=dt[0.3]['normal'], sigma=dt[0.3]['sigma'],
                       force={str(mu): dt[mu]['force'] for mu in MU}, out_stop=dt_out['force'])
    R['Z'] = dict(S1_beam=Z1_beam, S1_plain=Z1_full, S2_beam=Z2_beam, S2_plain=Z2_full)

    # ------------------------------------------------------------ masses and loads
    m_arm = sum(P[i].volume for i in range(4)) * DENS * FILL
    m_s2 = (P[2].volume + P[3].volume) * DENS * FILL
    m_s1 = P[1].volume * DENS * FILL
    BODY, POST = 10.0, 2.0
    MASS = {0: 8.0, 1: 9.0, 2: BODY + 2 * m_arm, 3: BODY + 2 * m_arm + POST}
    mass_src = 'assumed bodies of 8 / 9 / 10 g (heads / one-slot / slotted)'
    bj = os.path.join(HERE, 'body', 'body.json')
    if os.path.exists(bj):                                   # real body masses, from body.py
        B = json.load(open(bj))
        by = defaultdict(list)
        for r in B['bodies']: by[r['slots']].append(r['mm3'] * DENS * FILL)
        mean = lambda n: sum(by[n]) / len(by[n])
        ins = B['mass']['insert_mean']
        MASS = {0: mean(0), 1: mean(1) + ins, 2: mean(2) + 2 * m_arm, 3: mean(3) + 2 * m_arm + ins}
        mass_src = 'the real bodies from `BODY.md`'
    print(f'   masses: one arm {m_arm:.1f} g (A {P[0].volume * DENS * FILL:.1f}, S1 {m_s1:.1f}, S2 with foot and plug {m_s2:.1f}); pieces {{head {MASS[0]:.0f}, one-slot {MASS[1]:.0f}, two-slot {MASS[2]:.0f}, three-slot {MASS[3]:.0f}}} g ({mass_src})')
    R['mass'] = dict(arm=m_arm, S1=m_s1, S2_ins=m_s2, pieces=MASS, source=mass_src)

    print('== layouts (the game\'s ten trees)')
    import arm_options as O
    uniq = O.unique_trees()
    ext = P[0].bounds[1][0] - P[0].bounds[0][0]
    inboard, outer = FOOT_X - 0.0, P[2].bounds[1][0] - FOOT_X
    h_beam = Y_S2_BOT
    A.SLIDE_DROP, A.SLIDE_BEAM, A.SLIDE_STEM = DROP, h_beam, FOOT_W
    def trial(label, fn, design):
        A.BEAM_FN = fn
        res, _ = A.evaluate(uniq, design, 40.0)
        ok = [(n, A.extents(p)) for n, o, p in res if o]
        return label, res, ok
    from shapely.geometry import box as sb
    def rail(reach=72.0):
        def fn(px, py, ex, slot, ns):
            s = direction(slot, ns)
            if s == 0: return sb(px - FOOT_W / 2, py, px + FOOT_W / 2, py + h_beam)
            a, b = px - s * FOOT_W / 2, px + s * (reach + FOOT_W / 2 + 4)
            return sb(min(a, b), py, max(a, b), py + h_beam)
        return fn
    def bar(reach=72.0, tail=20.0):
        def fn(px, py, ex, slot, ns):
            s = direction(slot, ns)
            if s == 0: return sb(px - FOOT_W / 2, py, px + FOOT_W / 2, py + h_beam)
            d = abs(ex - px); Lb = reach + tail + FOOT_W
            end = px + s * (d + FOOT_W / 2); a, b = end, end - s * Lb
            return sb(min(a, b), py, max(a, b), py + h_beam)
        return fn
    def ideal(px, py, ex, slot, ns):
        return sb(min(px, ex) - FOOT_W / 2, py, max(px, ex) + FOOT_W / 2, py + h_beam)
    design = slide_design()
    rows = [trial('beam drawn only out to the carriage (the earlier test)', ideal, design),
            trial('fixed rail that stays out at full reach', rail(), design),
            trial('single bar that slides, with its tail', bar(), design),
            trial('two-stage telescope (this design)', telescope_beam(inboard, outer, h_beam), design)]
    for label, res, ok in rows:
        w = max((e[1][0] for e in ok), default=0); h = max((e[1][1] for e in ok), default=0)
        print(f'   {label:<58} builds {len(ok):>2}/{len(res)}   widest {w:.0f}  tallest {h:.0f}')
    R['variants'] = [dict(label=l, builds=len(ok), of=len(res), widest=max((e[1][0] for e in ok), default=0), tallest=max((e[1][1] for e in ok), default=0)) for l, res, ok in rows]
    A.BEAM_FN = telescope_beam(inboard, outer, h_beam)
    res, _ = A.evaluate(uniq, design, 40.0)
    park, _ = A.evaluate(uniq, design, 40.0, park=True)
    problems = []
    for n, ok, parts in res:
        if ok:
            bad = verify(parts)
            if bad: problems.append((n, bad[:2]))
    print(f'   trees built: {sum(1 for _, o, _ in res if o)} of {len(res)}; independent distance check problems: {len(problems)}   unused arms left on: {sum(1 for _, o, _ in park if o)} of {len(park)}')
    R['layout'] = dict(built=sum(1 for _, o, _ in res if o), of=len(res), problems=len(problems), parked=sum(1 for _, o, _ in park if o))
    sizes = {n: A.extents(p) for n, o, p in res if o}
    ao = json.load(open(os.path.join(HERE, 'out', 'arm_options.json')))
    R['sizes'] = {n: dict(slide=sizes.get(n)) for n in sizes}
    for r in ao['rows']:
        if r['tree'] in R['sizes']:
            R['sizes'][r['tree']]['swivel'] = r['C']; R['sizes'][r['tree']]['hinged'] = r['A']; R['sizes'][r['tree']]['ideal'] = r['D']

    # loads: the weight under every moving arm
    rows_l = []
    for name, ok, parts in res:
        if not ok: continue
        bodies = {i[1]: (g.centroid, i[0]) for k, g, i in parts if k == 'body'}
        kids = defaultdict(list); arms = []
        for k, g, i in parts:
            if k == 'arm': kids[i[3]].append(i[4]); arms.append((g, i))
        sub = lambda u: [u] + [x for c in kids[u] for x in sub(c)]
        for g, (st, t, slot, pu, cu) in arms:
            n = len(sp.PORTS.get(t, {}))
            if st.dx is None or direction(slot, n) == 0: continue
            W = sum(MASS[len(sp.PORTS.get(bodies[u][1], {}))] for u in sub(cu))
            rows_l.append(dict(tree=name, piece=t, grams=W, reach=abs(st.dx)))
    gr = sorted(r['grams'] for r in rows_l)
    pc = lambda a, p: a[min(len(a) - 1, int(p * len(a)))]
    Wmed, W90, Wmax = pc(gr, .5), pc(gr, .9), gr[-1]
    print(f'   {len(rows_l)} moving arms; the weight hanging from one: median {Wmed:.0f} g, 90% {W90:.0f} g, max {Wmax:.0f} g')
    sigma = {}
    for lab, Wg in (('median', Wmed), ('90%', W90), ('max', Wmax), ('abuse', None)):
        Wn = (Wg + m_s2 + m_s1) * H.G if Wg is not None else 15.0       # N (H.G is newtons per gram); abuse = 15 N, a hand pulling down on the carriage
        if Wg is None: Wg = Wn / H.G
        M1 = Wn * (xc_full - (tl))                              # at the end of A's tongue
        M2 = Wn * (xc_full - (STEP + tl))
        s1 = M1 / Z1_beam; s2 = M2 / Z2_beam
        Rup = Wn * (xc_full - STEP) / eng
        tau = Rup / (NECK * eng)
        twist = Wn * ZC / (HEAD + 2 * CLR)
        sigma[lab] = dict(grams=Wg, N=Wn, S1=s1, S2=s2, tongue_shear=tau, twist_flank=twist)
        print(f'   {lab:>6} {Wg:4.0f} g ({Wn:.1f} N): S1 {s1:5.1f} MPa (SF {SIG / s1:.1f}), S2 {s2:5.1f} MPa (SF {SIG / s2:.1f}), tongue shear {tau:.1f} MPa (SF {TAU / tau:.1f}), twist on a flank {twist:.1f} N')
    R['loads'] = dict(n_arms=len(rows_l), grams=dict(median=Wmed, p90=W90, max=Wmax), stress=sigma)
    # how far the slide can be tilted before the phrase pulls the stage out of its detent
    ang = []
    for r in rows_l:
        Wn = (r['grams'] + m_s2 + m_s1) * H.G
        ang.append(math.degrees(math.asin(min(1.0, dt[0.3]['force'] / Wn))))
    ang.sort()
    cov = {th: 100 * sum(1 for a in ang if a >= th) / len(ang) for th in (15, 30, 60, 90)}
    cov_mu = {}
    for mu in MU:
        c = 0
        for r in rows_l:
            Wn = (r['grams'] + m_s2 + m_s1) * H.G
            c += dt[mu]['force'] >= Wn
        cov_mu[mu] = 100 * c / len(rows_l)
    R['hold_cover_vertical_by_mu'] = {str(k): v for k, v in cov_mu.items()}
    print('   share of arms whose stage still holds with the slide pointing straight down (mu 0 / 0.3 / 0.45): ' + ' / '.join(f'{cov_mu[m]:.0f}%' for m in MU))
    print(f'   hold (mu 0.3): tilt of the slide from level that a stage still holds, over all arms: 10% {pc(ang, .1):.0f}, median {pc(ang, .5):.0f} degrees; share holding at 15/30/60/90 degrees: ' + ' / '.join(f'{cov[t]:.0f}%' for t in cov))
    R['hold_cover'] = {str(k): v for k, v in cov.items()}
    print('== figures')
    figure_sections(P, stub, post, os.path.join(OUT, 'sections.png'))
    figure_cross(P, stub, post, os.path.join(OUT, 'cross.png'))
    figure_parts(P, os.path.join(OUT, 'parts.png'))
    big = sorted(((A.extents(p)[0] * A.extents(p)[1], n) for n, o, p in res if o), reverse=True)
    names_f = [big[0][1], big[len(big) // 2][1]]
    A.BEAM_FN = telescope_beam(inboard, outer, h_beam)
    figure_trees(res, uniq, os.path.join(OUT, 'trees.png'), names_f)
    R['figure_trees'] = names_f
    A.BEAM_FN = None
    json.dump(R, open(os.path.join(OUT, 'slide.json'), 'w'), indent=1, default=float)
    write_doc(R, os.path.join(HERE, 'SLIDE.md'))
    import pickle
    pickle.dump(dict(res=[(n, o, p) for n, o, p in res]), open('/tmp/slide_res.pkl', 'wb'))
    return R, P, stub, post, res, uniq


if __name__ == '__main__':
    main()
