#!/usr/bin/env python3
"""
Concept pictures for the whiteboard kit: small thin shape tiles with a magnet in the back, ball-and-cup sticks, tiny word tiles.

1. out/concept_board.png  an illustration of a tree on a whiteboard (tile positions come from flat_layout.py's layout test;
                          sticks are drawn port to port, not re-verified)
2. out/concept_joint.png  a close-up from real meshes: tiles with cups, a stick with ball ends, a word tile

Run from the repo root:  python3 physical/concept.py
"""
import math, os, sys
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon, icosphere, box as tbox, cylinder
from trimesh.boolean import union, difference
from shapely.geometry import Polygon, Point, box as sbox
from shapely.affinity import scale as sscale
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon as MPoly, Circle

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import spokes as sp
import flat_layout as F
import arm_options as O
import hinge as H

OUT = os.path.join(HERE, 'out')
SIZE = {'phrase': 15.0, 'bar': 12.0, 'head-x': 9.0, 'head-xp': 9.0}       # tile half-size (mm): phrase 30, bar 24, head 18
THICK = 6.0
BALL_R, CUP_R = 2.5, 2.7
STICK_W, STICK_T = 4.0, 3.0


def shape_poly(shape, r):
    def ngon(n, rad, oy=0):
        return [(rad * math.cos(math.radians(-90 + 360 / n * i)), oy + rad * math.sin(math.radians(-90 + 360 / n * i))) for i in range(n)]
    if shape == 'circle': return Point(0, 0).buffer(r, 48)
    if shape == 'square': return sbox(-r, -r, r, r).buffer(r * .12, 8)
    if shape == 'rectangle': return sbox(-r * 1.35, -r * .78, r * 1.35, r * .78).buffer(r * .1, 8)
    if shape == 'triangle': return Polygon(ngon(3, r * 1.15, r * .08)).buffer(r * .06, 8)
    if shape == 'pentagon': return Polygon(ngon(5, r * 1.12, r * .06)).buffer(r * .05, 8)
    if shape == 'diamond': return Polygon(ngon(4, r * 1.2)).buffer(r * .05, 8)
    if shape == 'star':
        return Polygon([((r * 1.15 if i % 2 == 0 else r * .5) * math.cos(math.radians(-90 + 36 * i)), (r * 1.15 if i % 2 == 0 else r * .5) * math.sin(math.radians(-90 + 36 * i))) for i in range(10)]).buffer(r * .04, 6)
    if shape == 'heart': return Polygon([(x * r, y * r) for x, y in sp.heart_pts()]).buffer(0)
    raise ValueError(shape)


def node_info(t, cats):
    letter, level, star = sp.split_type(t)
    kind = sp.kind(t)
    return cats[letter]['shape'], cats[letter]['color'], SIZE[kind], kind


def label(t):
    return sp.label(t).replace(' (XP)', '').replace(' (X′)', '')


def ports(poly, n_slots):
    """top port and bottom ports (x, y), y down, relative to the tile centre."""
    minx, miny, maxx, maxy = poly.bounds
    w = maxx - minx
    top = (0.0, miny + 3.2)
    pitch = min(9.0, w * 0.3)
    bots = [((s - (n_slots - 1) / 2) * pitch, maxy - 3.2) for s in range(n_slots)]
    return top, bots


# ------------------------------------------------------------------ 1. the board
def board(path):
    cats, modes = sp.load()
    uniq = dict(O.unique_trees())
    name = 'prex:L2 the-fluffy-cat-will-jump'
    words = ['the', 'fluffy', 'cat', 'will', 'jump']
    tree = uniq[name]
    # rebuild the layout and read off the tree structure alongside it
    lay = F.Layout(tree, (60.0, 90.0))
    # tiles come out in depth-first order: the same order as walking the tree
    order = []
    def walk(n, parent):
        order.append((n['t'], parent)); idx = len(order) - 1
        for c in n['c']: walk(c, idx)
    walk(tree, -1)
    pos = {i: (x, y) for i, (t, x, y) in enumerate(lay.tiles)}
    fig, ax = plt.subplots(figsize=(11, 8), facecolor='white')
    ax.add_patch(FancyBboxPatch((-600, -600), 1200, 1500, boxstyle='round,pad=0,rounding_size=10', fc='#f7f8f6', ec='none', lw=0, zorder=0))
    polys = {}
    nslots = {}
    for i, (t, p) in enumerate(order):
        shape, col, r, kind = node_info(t, cats)
        polys[i] = shape_poly(shape, r)
        nslots[i] = len(sp.PORTS.get(t, {}))
    # sticks first (under the tiles' cups)
    kids_of = {}
    for i, (t, p) in enumerate(order):
        if p >= 0: kids_of.setdefault(p, []).append(i)
    stick_ends = []
    for p, kids in kids_of.items():
        t = order[p][0]
        slots, _ = __import__('arms').slot_assignment(t, [order[k][0] for k in kids])
        n = nslots[p]
        px, py = pos[p]
        _, bots = ports(polys[p], max(n, 1))
        for k, s in zip(kids, slots):
            bx, by = bots[s]
            top, _ = ports(polys[k], max(nslots[k], 1))
            a = (px + bx, py + by); b = (pos[k][0] + top[0], pos[k][1] + top[1])
            stick_ends.append((a, b))
    for a, b in stick_ends:
        ax.plot([a[0], b[0]], [a[1], b[1]], color='#4b5563', lw=4.2, solid_capstyle='butt', zorder=1)
        for q in (a, b):
            ax.add_patch(Circle(q, 3.0, fc='#c7ccd3', ec='#4b5563', lw=1.0, zorder=3))
            ax.add_patch(Circle((q[0] - .9, q[1] - .9), 0.9, fc='white', ec='none', zorder=4, alpha=.8))
    for i, (t, p) in enumerate(order):
        shape, col, r, kind = node_info(t, cats)
        x, y = pos[i]
        pts = np.array(polys[i].exterior.coords) + np.array([x, y])
        ax.add_patch(MPoly(pts, closed=True, fc=col, ec='#1f2937', lw=1.1, zorder=2, joinstyle='round'))
        ax.text(x, y + (2.5 if shape in ('triangle',) else 0), label(t), ha='center', va='center', fontsize=7.5 if r < 12 else 9, color='white', fontweight='bold', zorder=5)
    # word tiles under the heads (the leaves, left to right)
    leaves = [i for i, (t, p) in enumerate(order) if not kids_of.get(i)]       # depth-first order is sentence order
    for w, i in zip(words, leaves):
        x, y = pos[i]
        ax.add_patch(FancyBboxPatch((x - 13, y + 14), 26, 10, boxstyle='round,pad=0,rounding_size=1.5', fc='#f4ecd8', ec='#8a8372', lw=0.9, zorder=2))   # a poetry magnet
        ax.text(x, y + 19.2, w, ha='center', va='center', fontsize=8.5, color='#111827', zorder=5, family='serif')
    ax.set_title('On a steel whiteboard: every tile and word magnet has a magnet in its back; sticks are ball-and-cup joints', fontsize=10, loc='left', color='#374151')
    xs = [p[0] for p in pos.values()]; ys = [p[1] for p in pos.values()]
    ax.set_xlim(min(xs) - 60, max(xs) + 60); ax.set_ylim(max(ys) + 75, min(ys) - 50); ax.set_aspect('equal'); ax.axis('off')
    fig.tight_layout(); fig.savefig(path, dpi=110, facecolor=fig.get_facecolor()); plt.close(fig)


# ------------------------------------------------------------------ 2. the joint
MAG_BOARD = {'phrase': 8.0, 'bar': 8.0, 'head-x': 6.0, 'head-xp': 6.0}      # the board magnet's diameter (mm), by tile kind
MAG_JOINT = 3.0                                                               # the joint magnet behind each cup: 3 x 1.5 mm


def tile_mesh(shape, r, n_bottom, kind='phrase'):
    """A tile: the game's silhouette, 6 mm thick, a shallow cup at its top port and one at each bottom port in the front face,
    a pocket for the board magnet in the back, and a pocket for a small joint magnet behind each cup."""
    poly = shape_poly(shape, r)
    m = H.fix(extrude_polygon(poly, THICK, engine='earcut'))
    top, bots = ports(poly, n_bottom)
    cuts = []
    for (px, py) in [top] + bots:
        sph = icosphere(subdivisions=3, radius=CUP_R)
        sph.apply_translation([px, py, THICK + 0.9])              # a shallow cup (1.8 mm deep) in the front face, near the edge
        cuts.append(sph)
        jp = cylinder(radius=(MAG_JOINT + 0.2) / 2, height=3.9, sections=24)      # from the back to 0.3 mm behind the cup floor
        jp.apply_translation([px, py, 3.8 / 2 - 0.1])
        cuts.append(jp)
    d = MAG_BOARD.get(kind, 8.0)
    pocket = cylinder(radius=(d + 0.2) / 2, height=2.2, sections=40); pocket.apply_translation([0, 0, 0.9])
    cuts.append(pocket)
    return H.fix(difference([m] + cuts, engine='manifold')), top, bots


def stick_mesh(L):
    bar = tbox(extents=[L, STICK_W, STICK_T]); bar.apply_translation([L / 2, 0, STICK_T / 2])
    balls = []
    for x in (0.0, L):
        s = icosphere(subdivisions=3, radius=BALL_R); s.apply_translation([x, 0, STICK_T / 2 - 0.6]); balls.append(s)
    return H.fix(union([bar] + balls, engine='manifold'))


def word_tile(w=26.0, h=10.0):
    return H.fix(tbox(extents=[w, h, 2.4]))


def joint(path):
    import assemble as AS
    cats, modes = sp.load()
    meshes, cols = [], []
    def add(m, col):
        meshes.append(m); cols.append(np.tile(np.asarray(col, float), (len(m.faces), 1)))
    hexrgb = lambda hx: np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)], float) / 255
    par, ptop, pbots = tile_mesh('square', 15, 3, 'phrase')             # a TP
    chi, ctop, cbots = tile_mesh('triangle', 12, 2, 'phrase')           # an NP
    px, py = 0.0, 0.0
    a = (px + pbots[1][0], py + pbots[1][1])                  # the parent's middle bottom cup
    L = 30.0
    cx = a[0] - ctop[0]; cy = a[1] + L - ctop[1]
    def place(m, x, y):
        mm = m.copy(); mm.apply_translation([x, y, 0]); return mm
    add(place(par, px, py), hexrgb(cats['T']['color']))
    add(place(chi, cx, cy), hexrgb(cats['N']['color']))
    def stick_between(p, q, z):
        d = np.array(q) - np.array(p); Ls = float(np.linalg.norm(d)); ang = math.atan2(d[1], d[0])
        st = stick_mesh(Ls); st.apply_transform(H.rot_z(math.degrees(ang))); st.apply_translation([p[0], p[1], z]); return st
    add(stick_between(a, (cx + ctop[0], cy + ctop[1]), THICK + 0.15), hexrgb('#aeb6c0'))
    # a loose stick lying beside it, with its ball ends showing, and a word magnet
    add(stick_between((34.0, -8.0), (34.0, 52.0), 0.15), hexrgb('#aeb6c0'))
    wt = word_tile(26.0, 10.0); wt.apply_translation([-22.0, cy + 26.0, 1.2]); add(wt, hexrgb('#f4ecd8'))
    mesh = trimesh.util.concatenate(meshes); fc = np.vstack(cols)
    v = mesh.copy(); v.apply_scale([1, 1, -1]); v.invert()   # the front face (with the cups) toward the viewer; the board is behind
    v.apply_transform(H.rot_x(-90))                         # y down -> z down
    fig, axes = plt.subplots(1, 2, figsize=(15, 7.2), facecolor='white')
    axes[0].imshow(AS.render_color(v, fc, 900, 800, elev=3, azim=-90, zoom=0.96)); axes[0].axis('off'); axes[0].set_title('from the front (the whiteboard is behind)', loc='left')
    axes[1].imshow(AS.render_color(v, fc, 900, 800, elev=30, azim=-125, zoom=0.96)); axes[1].axis('off'); axes[1].set_title('from the side and above (the board is the far side)', loc='left')
    fig.suptitle('Two tiles (6 mm thick, magnet pocket in the back) joined by a stick with ball ends into cups; a loose stick; a poetry-style word magnet', fontsize=11)
    fig.tight_layout(); fig.savefig(path, dpi=100); plt.close(fig)


if __name__ == '__main__':
    board(os.path.join(OUT, 'concept_board.png'))
    print('board done')
    joint(os.path.join(OUT, 'concept_joint.png'))
    print('joint done')
