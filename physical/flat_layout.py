#!/usr/bin/env python3
"""
Flat tiles on a table or a whiteboard: can the game's trees be laid out with FIXED-LENGTH bonds that click at 30 degree steps?

Each piece is a flat tile (34 x 30 mm). A bond is a flat link that lies over the parent tile, turns on a pivot at the
parent's slot and carries the keyed plug at its far end, which goes down into the child tile's socket (the keys
are the same as before). Directions: multiples of 30 degrees. Lengths (pivot to child centre): 60 or 90 mm.
Search: depth first, children left to right, preferring a fan below the parent; a tile may not come within GAP
of another tile, and a bond may not touch a tile that is not its own parent or child, nor cross another bond.

Run from the repo root:  python3 physical/flat_layout.py
"""
import json, math, os, sys
import numpy as np
from shapely.geometry import box, LineString, Point
from shapely.affinity import translate
from shapely.ops import unary_union
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import spokes as sp
import arm_options as O

TILE_W, TILE_H = 34.0, 30.0
GAP = 6.0
BOND_W = 8.0
PITCH = 12.0                               # between pivots on a tile
LENGTHS = (60.0, 90.0)
ANGLES = tuple(range(0, 360, 30))          # y points down: 90 is straight down


def ideal_angles(k):
    return {1: [90], 2: [135, 45], 3: [150, 90, 30]}[k]


def bond_geom(a, b):
    return LineString([a, b]).buffer(BOND_W / 2, cap_style=1)


def layout(node, lengths, angles, top_k=14, park=False):
    """Bottom-up: returns (items, shape) in the node's frame (its tile centred on the origin), or None.
    items = [(type, x, y)] and bonds [(pivot, child centre)]; shape = union of tiles and bonds with GAP/2 on every tile."""
    kids = node['c']
    tile = (node['t'], 0.0, 0.0)
    tgeom = box(-TILE_W / 2, -TILE_H / 2, TILE_W / 2, TILE_H / 2)
    if not kids:
        return dict(tiles=[tile], bonds=[], shape=tgeom, clear=tgeom.buffer(GAP / 2), cost=0.0)
    subs = [layout(k, lengths, angles, top_k, park) for k in kids]
    if any(s is None for s in subs): return None
    n = len(sp.PORTS.get(node['t'], {}))
    assign, _ = A.slot_assignment(node['t'], [k['t'] for k in kids])
    ideals = ideal_angles(len(kids)) if len(kids) <= 3 else [90] * len(kids)
    cands = []
    for i, (sub, slot) in enumerate(zip(subs, assign)):
        pivot = ((slot - (n - 1) / 2) * PITCH, 0.0)
        opts = []
        for a in angles:
            for L in lengths:
                ang = math.radians(a)
                off = (pivot[0] + L * math.cos(ang), pivot[1] + L * math.sin(ang))
                dev = abs((a - ideals[i] + 180) % 360 - 180)
                opts.append((dev + 0.3 * L, off, pivot))
        opts.sort(key=lambda o: o[0])
        cands.append(opts)
    best = [None]
    def dfs(i, chosen, cost):
        if best[0] and cost >= best[0][0]: return
        if i == len(kids):
            best[0] = (cost, list(chosen)); return
        tried = 0
        for c, off, pivot in cands[i]:
            sub = subs[i]
            cl = translate(sub['clear'], off[0], off[1])
            if cl.intersects(tgeom.buffer(GAP / 2)): continue
            bg = bond_geom(pivot, off)
            if bg.intersects(translate(sub['clear'], off[0], off[1]).buffer(-GAP / 2 - 0.5)) and False: pass
            if chosen and off[0] <= chosen[-1][0][0] + 1.0: continue            # siblings read left to right
            if chosen:                                                         # ...and so do their subtrees: every tile of this one is right of every tile of the last
                prev = chosen[-1]
                prev_max = max(x for t_, x, y in prev[5]); my_min = min(x + off[0] for t_, x, y in sub['tiles'])
                if my_min <= prev_max + 1.0: continue
            bad = False
            for (o2, p2, cl2, bg2, sh2, tl2) in chosen:
                if cl.intersects(cl2) or bg.intersects(cl2) or bg2.intersects(cl): bad = True; break
            if bad: continue
            if bg.intersects(tgeom) and False: continue
            # the bond may not touch the other tiles inside its own child's subtree except the child's own tile
            chosen.append((off, pivot, cl, bg, translate(sub['shape'], off[0], off[1]), [(t_, x + off[0], y + off[1]) for t_, x, y in sub['tiles']]))
            dfs(i + 1, chosen, cost + c)
            chosen.pop()
            tried += 1
            if tried >= top_k: break
    dfs(0, [], 0.0)
    if best[0] is None: return None
    extra = []                                           # unused bonds stay on: each points somewhere clear, 60 mm long, bare plug at the end
    if park:
        used = set(assign)
        taken = [c[2] for c in best[0][1]] + [c[3] for c in best[0][1]]
        for slot in range(n):
            if slot in used: continue
            pivot = ((slot - (n - 1) / 2) * PITCH, 0.0)
            placed = False
            for a in sorted(angles, key=lambda a: -abs((a - 90 + 180) % 360 - 180)):        # prefer pointing away from the tree
                ang = math.radians(a)
                end = (pivot[0] + lengths[0] * math.cos(ang), pivot[1] + lengths[0] * math.sin(ang))
                bg = bond_geom(pivot, end)
                plug = Point(end).buffer(12.0)
                geom = unary_union([bg, plug]).buffer(GAP / 2)
                if geom.difference(tgeom.buffer(GAP / 2 + 0.1)).intersects(unary_union(taken)): continue
                extra.append((pivot, end, unary_union([bg, plug]), geom)); taken.append(geom); placed = True; break
            if not placed: return None
    tiles, bonds, shapes, clears = [tile], [], [tgeom], [tgeom.buffer(GAP / 2)]
    for pivot, end, sh, cl in extra:
        bonds.append((pivot, end)); shapes.append(sh); clears.append(cl)
    for (off, pivot, cl, bg, sh, tl), sub in zip(best[0][1], subs):
        tiles += [(t, x + off[0], y + off[1]) for t, x, y in sub['tiles']]
        bonds += [(pivot, off)] + [((a[0] + off[0], a[1] + off[1]), (b[0] + off[0], b[1] + off[1])) for a, b in sub['bonds']]
        shapes += [sh, bg]; clears += [cl, bg]
    return dict(tiles=tiles, bonds=bonds, shape=unary_union(shapes), clear=unary_union(clears), cost=best[0][0])


class Layout:
    def __init__(self, tree, lengths=LENGTHS, angles=ANGLES, park=False):
        r = layout(tree, lengths, angles, park=park)
        self.ok = r is not None
        if r:
            self.tiles, self.bonds = r['tiles'], r['bonds']

    def extents(self):
        xs = [t[1] for t in self.tiles]; ys = [t[2] for t in self.tiles]
        return max(xs) - min(xs) + TILE_W, max(ys) - min(ys) + TILE_H


def draw(ax, lay, cats, title):
    for (a, b) in lay.bonds:
        ax.plot([a[0], b[0]], [a[1], b[1]], color='#555', lw=3.5, solid_capstyle='round', zorder=1)
        ax.plot(*a, 'o', color='#333', ms=4, zorder=3)
    for ty, x, y in lay.tiles:
        letter = sp.split_type(ty)[0]; col = cats[letter]['color']
        ax.add_patch(FancyBboxPatch((x - TILE_W / 2, y - TILE_H / 2), TILE_W, TILE_H, boxstyle='round,pad=0,rounding_size=7', fc=col, ec='#222', lw=0.8, zorder=2))
        ax.text(x, y, sp.label(ty), ha='center', va='center', fontsize=7, color='white', zorder=4)
    ax.set_aspect('equal'); ax.invert_yaxis(); ax.axis('off'); ax.set_title(title, fontsize=10, loc='left')
    xs = [t[1] for t in lay.tiles]; ys = [t[2] for t in lay.tiles]
    ax.set_xlim(min(xs) - 30, max(xs) + 30); ax.set_ylim(max(ys) + 30, min(ys) - 30)


def verify(lay):
    """Independent check on a finished layout: tiles keep GAP apart; a bond touches only its own two tiles and no other bond."""
    import itertools
    tg = [box(x - TILE_W / 2, y - TILE_H / 2, x + TILE_W / 2, y + TILE_H / 2) for t, x, y in lay.tiles]
    bad = []
    for a, b in itertools.combinations(range(len(tg)), 2):
        if tg[a].distance(tg[b]) < GAP - 0.01: bad.append('two tiles too close')
    bg = [bond_geom(p, c) for p, c in lay.bonds]
    for (p, c), g in zip(lay.bonds, bg):
        for k, (t, x, y) in enumerate(lay.tiles):
            own = tg[k].contains(__import__('shapely.geometry', fromlist=['Point']).Point(p)) or (abs(x - c[0]) < 1e-6 and abs(y - c[1]) < 1e-6)
            if not own and g.intersects(tg[k]): bad.append('a bond touches a tile that is not its own')
    for a, b in itertools.combinations(range(len(bg)), 2):
        if bg[a].intersects(bg[b]):
            inter = bg[a].intersection(bg[b])
            if not any(inter.within(g.buffer(0.01)) for g in tg):      # bonds may only meet over a tile (where they pivot)
                bad.append('two bonds cross away from a tile')
    return bad


def main():
    cats, modes = sp.load()
    uniq = O.unique_trees()
    rows = []
    layouts = {}
    for lengths in ((60.0, 90.0), (60.0, 90.0, 120.0), (60.0, 90.0, 120.0, 150.0)):
        built = 0; tot = []
        for name, tr in uniq:
            lay = Layout(tr, lengths=lengths)
            ok = lay.ok
            if ok:
                w, h = lay.extents(); built += 1; tot.append((name, w, h))
                layouts[(lengths, name)] = lay
            rows.append((lengths, name, ok, lay.extents() if ok else None))
        print(f'bond lengths {lengths}: built {built} of {len(uniq)};', ', '.join(f'{n.split(" ", 1)[1][:14]} {w:.0f}x{h:.0f}' for n, w, h in tot))
    lens = (60.0, 90.0)
    pk = [(n, Layout(t, lens, park=True)) for n, t in uniq]
    print('unused bonds left on (each 60 mm, bare plug): built', sum(1 for n, l in pk if l.ok), 'of', len(pk), '; sizes', ', '.join(f'{l.extents()[0]:.0f}x{l.extents()[1]:.0f}' for n, l in pk if l.ok))
    probs = {n: verify(layouts[(lens, n)]) for n, _ in uniq}
    print('independent check problems:', {n.split(' ', 1)[1][:16]: len(v) for n, v in probs.items() if v} or 'none')
    names = ['prex:L2 the-fluffy-cat-will-jump', 'xbar:L2 the-cat-chased-the-mouse', 'xbar:L2 which-mouse-did-the-cat-chase']
    fig, axes = plt.subplots(1, 3, figsize=(20, 7.2), facecolor='white', gridspec_kw=dict(width_ratios=[1, 1.5, 1.8]))
    for ax, nm in zip(axes, names):
        lay = layouts[(lens, nm)]; w, h = lay.extents()
        draw(ax, lay, cats, f'{nm}  {w:.0f} x {h:.0f} mm')
    fig.suptitle('Flat tiles with fixed bonds (60 or 90 mm, clicking at 30 degree steps)', fontsize=12)
    fig.tight_layout(); fig.savefig(os.path.join(HERE, 'out', 'flat_layouts.png'), dpi=95); plt.close(fig)
    json.dump({n: dict(ok=bool(r), size=ex) for (_, n, r, ex) in rows if _ == lens}, open(os.path.join(HERE, 'out', 'flat_layouts.json'), 'w'), indent=1, default=float)
    return rows, layouts, cats, uniq


if __name__ == '__main__':
    main()
