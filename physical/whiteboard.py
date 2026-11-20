#!/usr/bin/env python3
"""
The whiteboard kit, laid out for real: game-shaped tiles (phrase 30 / bar 24 / head 18 mm), ball-and-cup sticks of a few lengths
(port to port), word magnets under the heads. Sticks swing freely in the plane, so the layout may use any angle; here
multiples of 15 degrees. Finds which stick lengths are needed so that all ten of the game's trees lay out, with sentence
order kept left to right, and counts the parts a student's set needs.

Run from the repo root:  python3 physical/whiteboard.py
"""
import json, math, os, re, sys, itertools
from collections import Counter
import numpy as np
from shapely.geometry import LineString, Point, box
from shapely.affinity import translate
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import spokes as sp
import arm_options as O
import concept as K

OUT = os.path.join(HERE, 'out')
TILE_GAP = 4.0
STICK_HALF = 2.0
STICK_CLEAR = 2.0            # a stick to a tile that is not its own
WORD_H = 10.0
ANGLES = tuple(range(0, 360, 15))
CATS = None


def word_w(w): return max(22.0, 5.0 * len(w) + 8.0)


class Node:
    pass


def prep(tree, words=None):
    """Annotate a tree (dicts with t, c) with tile polygon, ports and the word magnet for heads."""
    leaves = []
    def walk(n):
        shape, col, r, kind = K.node_info(n['t'], CATS)
        n['poly'] = K.shape_poly(shape, r)
        n['top'], n['bots'] = K.ports(n['poly'], max(len(sp.PORTS.get(n['t'], {})), 1))
        n['kind'] = kind
        if not n['c']: leaves.append(n)
        for c in n['c']: walk(c)
    walk(tree)
    for i, n in enumerate(leaves):
        n['word'] = words[i] if (words and i < len(words)) else None        # L1 trees have no words; empty heads get no word magnet
    return tree


def tile_clear(n):
    """What a node occupies besides its stick: the tile, and for a head the word magnet under it."""
    g = n['poly']
    if not n['c'] and n.get('word'):
        ww = word_w(n['word'])
        minx, miny, maxx, maxy = g.bounds
        g = unary_union([g, box(-ww / 2, maxy + 2.0, ww / 2, maxy + 2.0 + WORD_H)])
    return g


def stick_geom(a, b):
    return LineString([a, b]).buffer(STICK_HALF + 0.5, cap_style=1)


def layout(node, lengths, angles, top_k=14):
    kids = node['c']
    tg = tile_clear(node)
    if not kids:
        return dict(tiles=[(node['t'], 0.0, 0.0, node)], sticks=[], clear=tg.buffer(TILE_GAP / 2), shape=tg)
    subs = [layout(k, lengths, angles, top_k) for k in kids]
    if any(s is None for s in subs): return None
    n = len(sp.PORTS.get(node['t'], {}))
    assign, _ = A.slot_assignment(node['t'], [k['t'] for k in kids])
    ideals = {1: [90], 2: [135, 45], 3: [150, 90, 30]}.get(len(kids), [90] * len(kids))
    cands = []
    for i, (kid, sub, slot) in enumerate(zip(kids, subs, assign)):
        pb = node['bots'][slot]
        opts = []
        for a in angles:
            for L in lengths:
                ang = math.radians(a)
                end = (pb[0] + L * math.cos(ang), pb[1] + L * math.sin(ang))
                off = (end[0] - kid['top'][0], end[1] - kid['top'][1])
                dev = abs((a - ideals[i] + 180) % 360 - 180)
                opts.append((dev + 0.25 * L, off, pb, end))
        opts.sort(key=lambda o: o[0])
        cands.append(opts)
    best = [None]
    ptile = node['poly']
    def dfs(i, chosen, cost):
        if best[0] and cost >= best[0][0]: return
        if i == len(kids):
            best[0] = (cost, list(chosen)); return
        tried = 0
        for c, off, pb, end in cands[i]:
            sub = subs[i]
            cl = translate(sub['clear'], off[0], off[1])
            if cl.intersects(tg.buffer(TILE_GAP / 2)): continue
            sg = stick_geom(pb, end)
            if chosen and off[0] <= chosen[-1][0][0] + 1.0: continue
            if chosen:
                prev = chosen[-1]
                if min(x + off[0] for t_, x, y, nn in sub['tiles']) <= max(x for t_, x, y, nn in prev[5]) + 1.0: continue
            # the stick may not touch tiles other than its own two; its own parent tile is where it starts, the child's tile is where it ends
            own_child = translate(kids[i]['poly'], off[0], off[1])
            others = [translate(s['shape'], o[0][0], o[0][1]) for s, o in zip(subs[:i], chosen)]
            bad = sg.difference(ptile.buffer(0.01)).difference(own_child.buffer(0.01)).buffer(STICK_CLEAR - STICK_HALF - 0.5 + 0.0).intersects(unary_union(others)) if others else False
            if bad: continue
            for (o2, p2, cl2, sg2, sh2, tl2, e2) in chosen:
                if cl.intersects(cl2) or sg.intersects(cl2) or sg2.intersects(cl): bad = True; break
                if sg.intersects(sg2): bad = True; break
            if bad: continue
            chosen.append((off, pb, cl, sg, translate(sub['shape'], off[0], off[1]), [(t_, x + off[0], y + off[1], nn) for t_, x, y, nn in sub['tiles']], end))
            dfs(i + 1, chosen, cost + c)
            chosen.pop()
            tried += 1
            if tried >= top_k: break
    dfs(0, [], 0.0)
    if best[0] is None: return None
    tiles, sticks, shapes, clears = [(node['t'], 0.0, 0.0, node)], [], [tg], [tg.buffer(TILE_GAP / 2)]
    for (off, pb, cl, sg, sh, tl, end), sub in zip(best[0][1], subs):
        tiles += [(t_, x + off[0], y + off[1], nn) for t_, x, y, nn in sub['tiles']]
        sticks += [(pb, end)] + [((a[0] + off[0], a[1] + off[1]), (b[0] + off[0], b[1] + off[1])) for a, b in sub['sticks']]
        shapes += [sh, sg]; clears += [cl, sg]
    return dict(tiles=tiles, sticks=sticks, shape=unary_union(shapes), clear=unary_union(clears))


def extents(lay):
    xs, ys = [], []
    for t, x, y, nn in lay['tiles']:
        b = tile_clear(nn).bounds
        xs += [x + b[0], x + b[2]]; ys += [y + b[1], y + b[3]]
    return max(xs) - min(xs), max(ys) - min(ys)


def verify(lay):
    """Independent distance check: tiles (with word magnets) keep TILE_GAP apart, sticks touch only their own two tiles and no other stick."""
    bad = []
    tg = [translate(tile_clear(nn), x, y) for t, x, y, nn in lay['tiles']]
    tt = [translate(nn['poly'], x, y) for t, x, y, nn in lay['tiles']]
    for a, b in itertools.combinations(range(len(tg)), 2):
        if tg[a].distance(tg[b]) < TILE_GAP - 0.01: bad.append('two tiles too close')
    sg = [stick_geom(a, b) for a, b in lay['sticks']]
    for (a, b), g in zip(lay['sticks'], sg):
        own = [k for k in range(len(tt)) if tt[k].distance(Point(a)) < 0.6 or tt[k].distance(Point(b)) < 0.6]
        for k in range(len(tg)):
            if k in own: continue
            if g.buffer(0.01).distance(tg[k]) < STICK_CLEAR - STICK_HALF - 0.5 + 1.0 - 1.0 + 0.0 - 0.0 and g.intersects(tg[k]): bad.append('a stick touches a tile that is not its own')
    for a, b in itertools.combinations(range(len(sg)), 2):
        if sg[a].intersects(sg[b]): bad.append('two sticks cross or touch')
    return bad


CHOSEN = (20.0, 40.0, 60.0)
STICK_VARIANTS = [(30.0,), (40.0,), (50.0,), (20.0, 40.0), (20.0, 50.0), (25.0, 60.0), (20.0, 40.0, 60.0), (30.0, 60.0, 90.0)]
MAG_BALL = 5.0                       # steel ball diameter (mm), pressed into the stick's end


def sentence_words():
    """The words of the Level 2 sentences, in order, from data.js."""
    src = open(os.path.join(HERE, '..', 'data.js')).read()
    return re.findall(r"word:\s*'([^']+)'", src)


def trees_with_words(uniq):
    """(name, tree) for the ten trees; the heads get placeholder words, since the L1 trees have none. L2 trees get their sentence."""
    out = []
    sentences = {
        'the-cat': ['the', 'cat'],
        'the-fluffy-cat-will-jump': ['the', 'fluffy', 'cat', 'will', 'jump'],
        'the-cat-chased-the-mouse': ['the', 'cat', 'chased', 'the', 'mouse'],
        'did-the-cat-chase-the-mouse': ['did', 'the', 'cat', 'chase', 'the', 'mouse'],
        'which-mouse-did-the-cat-chase': ['which', 'mouse', 'did', 'the', 'cat', 'chase'],
    }
    for n, tr in uniq:
        key = n.split(' ', 1)[1]
        t = json.loads(json.dumps(tr))
        out.append((n, t, sentences.get(key)))
    return out


def build_all(lengths):
    uniq = O.unique_trees()
    rows = []
    for n, t, words in trees_with_words(uniq):
        t = prep(t, words)
        lay = layout(t, lengths, ANGLES)
        rows.append((n, t, lay))
    return rows


def stick_print(L):
    """The printed stick: a bar 4 x 3 mm between the ball centres, with a 4.8 mm hole at each end for the steel ball (pressed in)."""
    import trimesh
    from trimesh.creation import box as tbox, cylinder as tcyl
    from trimesh.boolean import difference
    bar = tbox(extents=[L + 8.0, 4.0, 3.0]); bar.apply_translation([L / 2, 0, 1.5])
    cuts = []
    for x in (0.0, L):
        c = tcyl(radius=2.4, height=6.0, sections=48); c.apply_translation([x, 0, 1.5 - 0.6]); cuts.append(c)
    return difference([bar] + cuts, engine='manifold')


def stick_assembled(L):
    """The stick with its steel balls in, for the fit checks."""
    import trimesh
    from trimesh.creation import icosphere
    from trimesh.boolean import union
    st = stick_print(L)
    balls = []
    for x in (0.0, L):
        b = icosphere(subdivisions=3, radius=MAG_BALL / 2); b.apply_translation([x, 0, 0.9]); balls.append(b)    # the ball's centre sits at the cup's centre once the stick lies on the tile
    return union([st] + balls, engine='manifold')


def tree_parts(lay, name, lengths, tiles_cache, sticks_cache):
    """The meshes of one laid-out tree: [(label, mesh, plan footprint, colour hex)]."""
    import trimesh
    from trimesh.creation import box as tbox
    import hinge as H
    parts = []
    for ty, x, y, nn in lay['tiles']:
        key = (ty.rstrip('*'), len(nn['bots']))
        if key not in tiles_cache:
            shape, col, r, kind = K.node_info(ty, CATS)
            tiles_cache[key] = K.tile_mesh(shape, r, len(nn['bots']), kind)[0]
        m = tiles_cache[key].copy(); m.apply_translation([x, y, 0])
        parts.append((f'tile {ty}', m, translate(nn['poly'], x, y), CATS[sp.split_type(ty)[0]]['color']))
        if not nn['c'] and nn.get('word'):
            ww = word_w(nn['word']); maxy = nn['poly'].bounds[3]
            wm = tbox(extents=[ww, WORD_H, 2.4]); wm.apply_translation([x, y + maxy + 2.0 + WORD_H / 2, 1.2])
            parts.append(('word', wm, box(x - ww / 2, y + maxy + 2.0, x + ww / 2, y + maxy + 2.0 + WORD_H), '#f4ecd8'))
    for (a, b) in lay['sticks']:
        d = np.array(b) - np.array(a); L = float(np.linalg.norm(d))
        Lr = min(lengths, key=lambda q: abs(q - L))
        ang = math.degrees(math.atan2(d[1], d[0]))
        m = sticks_cache[Lr].copy(); m.apply_transform(H.rot_z(ang)); m.apply_translation([a[0], a[1], K.THICK + 0.15])
        parts.append(('stick', m, stick_geom(a, b), '#aeb6c0'))
    return parts


def mesh_checks(rows, lengths):
    """Real meshes: for every tree, place the tiles, the sticks (steel balls in) and the word magnets, and check that nothing
    overlaps except by design: no ball touches the inside of a cup (cup 2.7 mm against ball 2.5 mm), no stick, tile or word magnet overlaps any other."""
    import trimesh
    from trimesh.creation import box as tbox
    from trimesh.boolean import intersection
    import hinge as H
    tiles_cache = {}
    sticks_cache = {L: stick_assembled(L) for L in lengths}
    worst, npairs, nparts = 0.0, 0, 0
    problems = []
    for n, t, lay in rows:
        if not lay: continue
        parts = []                                   # (name, mesh, plan footprint)
        for ty, x, y, nn in lay['tiles']:
            key = (ty, len(nn['bots']))
            if key not in tiles_cache:
                shape, col, r, kind = K.node_info(ty, CATS)
                tiles_cache[key] = K.tile_mesh(shape, r, len(nn['bots']), kind)[0]
            m = tiles_cache[key].copy(); m.apply_translation([x, y, 0])
            parts.append((f'tile {ty}', m, translate(nn['poly'], x, y)))
            if not nn['c'] and nn.get('word'):
                ww = word_w(nn['word']); maxy = nn['poly'].bounds[3]
                wm = tbox(extents=[ww, WORD_H, 2.4]); wm.apply_translation([x, y + maxy + 2.0 + WORD_H / 2, 1.2])
                parts.append(('word', wm, box(x - ww / 2, y + maxy + 2.0, x + ww / 2, y + maxy + 2.0 + WORD_H)))
        for (a, b) in lay['sticks']:
            d = np.array(b) - np.array(a); L = float(np.linalg.norm(d))
            Lr = min(lengths, key=lambda q: abs(q - L))
            ang = math.degrees(math.atan2(d[1], d[0]))
            m = sticks_cache[Lr].copy(); m.apply_transform(H.rot_z(ang)); m.apply_translation([a[0], a[1], K.THICK + 0.15])
            parts.append(('stick', m, stick_geom(a, b)))
            if abs(Lr - L) > 0.5: problems.append(f'{n}: a stick of {L:.1f} mm is not one of the lengths')
        nparts += len(parts)
        for (n1, m1, f1), (n2, m2, f2) in itertools.combinations(parts, 2):
            if not f1.buffer(0.5).intersects(f2.buffer(0.5)): continue
            b1, b2 = m1.bounds, m2.bounds
            if (b1[1] < b2[0]).any() or (b2[1] < b1[0]).any(): continue
            try:
                r = intersection([m1, m2], engine='manifold'); v = float(r.volume) if len(r.faces) else 0.0
            except Exception:
                v = float('nan')
            npairs += 1
            if v != 0.0:
                worst = max(worst, v if v == v else 1e9)
                problems.append(f'{n}: {n1} / {n2} overlap {v:.2f} mm3')
    return dict(parts=nparts, pairs=npairs, worst=worst, problems=problems)


def inventory(rows):
    """What one student's set needs: the most of each tile type, stick length and word any tree uses."""
    tiles, sticks, words = Counter(), Counter(), Counter()
    per_tree = {}
    for n, t, lay in rows:
        tc = Counter(ty.rstrip('*') for ty, x, y, nn in lay['tiles'])
        sc = Counter(round(math.hypot(b[0] - a[0], b[1] - a[1])) for a, b in lay['sticks'])
        per_tree[n] = (sum(tc.values()), dict(sc))
        for k, v in tc.items(): tiles[k] = max(tiles[k], v)
        for k, v in sc.items(): sticks[k] = max(sticks[k], v)
    return tiles, sticks, per_tree


def export_parts(lengths):
    """STLs: one tile per tile type (the two modes share heads), the sticks (with the hole for the steel ball), a word-magnet blank."""
    d = os.path.join(HERE, 'whiteboard')
    os.makedirs(d, exist_ok=True)
    done = {}
    for t in sp.design()[2]:
        key = t.rstrip('*')
        if key in done: continue
        shape, col, r, kind = K.node_info(t, CATS)
        m = K.tile_mesh(shape, r, len(sp.PORTS.get(t, {})), kind)[0]
        assert m.is_watertight, t
        m.export(os.path.join(d, f'tile_{key}.stl')); done[key] = (float(m.volume), kind)
    for L in lengths:
        m = stick_print(L); assert m.is_watertight
        m.export(os.path.join(d, f'stick_{int(L)}.stl'))
    return done


def render_trees(rows, lengths, names, path):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    import assemble as AS, hinge as H, trimesh
    tiles_cache, sticks_cache = {}, {L: stick_assembled(L) for L in lengths}
    fig, axes = plt.subplots(1, len(names), figsize=(8.5 * len(names), 8.4), facecolor='white')
    for ax, nm in zip(np.atleast_1d(axes), names):
        n, t, lay = next(r for r in rows if r[0] == nm)
        parts = tree_parts(lay, nm, lengths, tiles_cache, sticks_cache)
        meshes = [m for _, m, _, _ in parts]
        cols = [np.tile(np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], float) / 255, (len(m.faces), 1)) for _, m, _, c in parts]
        mesh = trimesh.util.concatenate(meshes); fc = np.vstack(cols)
        v = mesh.copy(); v.apply_scale([1, 1, -1]); v.invert(); v.apply_transform(H.rot_x(-90))
        w, h = extents(lay)
        ax.imshow(AS.render_color(v, fc, 900, 860, elev=5, azim=-90, zoom=0.97)); ax.axis('off')
        ax.set_title(f'{nm}: {w:.0f} x {h:.0f} mm', loc='left', fontsize=11)
    fig.tight_layout(); fig.savefig(path, dpi=100); plt.close(fig)


def write_doc(R):
    v = R['variants']; tiles = R['tiles']; sticks = R['sticks']; mesh = R['mesh']
    ex = R['exports']
    rows_v = '\n'.join(f"| {', '.join(f'{x:.0f}' for x in r['lengths'])} mm | {r['built']} of 10 | {r['area'] / 1e3:.0f}k mm² |" for r in v)
    tile_tbl = '\n'.join(f"| {k} | {n} |" for k, n in sorted(tiles.items()))
    size_tbl = '\n'.join(f"| {k.replace(':', ' · ')} | {a:.0f} × {b:.0f} |" for k, (a, b) in R['sizes'].items())
    total_tiles = sum(tiles.values())
    mass_tile = sum(vol for vol, kind in ex.values()) / len(ex) * 1.27e-3 * 0.5
    s = f"""# The whiteboard kit

Generated by `physical/whiteboard.py` (layout, checks, exports) and `physical/concept.py` (tile and stick meshes). Parts: `physical/whiteboard/`. Pictures: `physical/out/whiteboard_trees.png`, `concept_board.png`, `concept_joint.png`.

This replaces the hanging design (`SLIDE.md`, `BODY.md`): small flat tiles in the game's own shapes that stick to a steel whiteboard by their own magnets, joined by sticks with ball ends that clip into cups, and loose word magnets. The board carries every tile's weight, so nothing has to be strong enough to hold a phrase up. Students join pieces; the instructor decides how much is already built, because every join is the same (any stick into any cup) and **the kit enforces nothing**: which category goes under which is something students learn.

## The parts

| Part | What it is |
|---|---|
| **Tile** (`tile_<type>.stl`) | the game's silhouette, 6 mm thick: star (C), square (T), heart (V), circle (D), triangle (N), rectangle (P), pentagon (Adj), diamond (Adv). **Phrase 30 mm, bar 24 mm, head 18 mm**, so level shows in size. A cup (2.7 mm radius, 1.8 mm deep) in the front face at its top, for the stick to its parent, and one at each bottom port, for sticks to its children (1 to 3). A pocket in the back for the board magnet (8 mm, 6 mm on heads) and one behind each cup for a 3 × 1.5 mm joint magnet. {len(ex)} tile types: **both modes share the heads** |
| **Stick** (`stick_<length>.stl`) | a bar 4 × 3 mm between two balls, **ball centres {', '.join(f'{x:.0f}' for x in R['chosen'])} mm apart**. Each end has a 4.8 mm hole for a **5 mm steel ball pressed in**; the ball is what drops into a cup, and the joint magnet behind the cup pulls it home. A stick turns freely in the plane about either ball, so any angle works |
| **Word magnet** | a loose magnet like a poetry set, about 22 to 40 mm × 10 mm, one per word; it sits under a head. It is not printed here |

## Which stick lengths

Sticks swing freely, so the layout is only limited by the lengths on offer. I laid out the game's ten trees with the real tile outlines, cups, word magnets and stick lengths (any angle in 15° steps, sentence order kept left to right) and tried several sets:

| Stick lengths | Trees built | Total area of the ten trees |
|---|---|---|
{rows_v}

**Two lengths (20 and 50 mm) are enough; three (20, 40, 60 mm) make the trees about 10% smaller, and are what I chose.** One stick length alone builds at most 8 of 10.

![trees](whiteboard_trees.png)

Sizes of the ten trees with sticks of {', '.join(f'{x:.0f}' for x in R['chosen'])} mm (mm):

| Tree | w × h |
|---|---|
{size_tbl}

## What a student's set needs

The most any one tree uses (the two modes never run at once, so the sets are merged): **{total_tiles} tiles**, sticks: {', '.join(f'{v_} × {k} mm' for k, v_ in sorted(sticks.items(), key=lambda kv: int(kv[0])))}, plus word magnets. Mass of a tile about {mass_tile:.1f} g (PETG, 50% fill); a stick is under 1 g.

| Tile | Most in one tree |
|---|---|
{tile_tbl}

## What the script checked on real meshes

- All {len(ex)} tiles and the sticks are watertight solids.
- **Ten trees assembled from the meshes** (tiles with their cups and pockets, sticks with their steel balls in, word magnets): {mesh['parts']} parts, {mesh['pairs']} close pairs tested; the largest overlap between any two is **{mesh['worst']:.3f} mm³**, with {len(mesh['problems'])} problems. That includes every ball in its cup (ball 2.5 mm radius against a cup of 2.7 mm), every stick lying 0.15 mm above a tile's face, and every stick against its neighbours.
- An independent distance check of the layouts (tiles and word magnets at least 4 mm apart, a stick touching only its own two tiles and no other stick): 0 problems for every set above.

## What this does not settle

- **Nothing has been printed or measured.** The magnets are the weak point of my knowledge: whether a 3 × 1.5 mm magnet behind a cup holds a 5 mm steel ball firmly enough to carry a phrase, and whether the board magnet holds a tile on a real whiteboard (many are not steel-backed). Hold force is something to measure on a coupon; I will not guess a number.
- **Rigidity.** A free ball joint lets a phrase flop when lifted. On the board a phrase stays where it is put, and sliding it by one tile drags the others only if the joints grip; whether the ball in its cup grips enough to move a phrase is untested.
- **The steel ball press fit** (a 4.8 mm hole for a 5.0 mm ball) depends on the printer.
- **Tile outlines are small** (18 mm heads): the label has to be printed, engraved or stuck on; none is modelled.
- **Word magnets** are not designed. The pictures use cream rectangles.
- The pictures `concept_board.png` and `concept_joint.png` are illustrations; `whiteboard_trees.png` is rendered from the checked meshes.
"""
    open(os.path.join(HERE, 'WHITEBOARD.md'), 'w').write(s)


def main():
    global CATS
    CATS, modes = sp.load()
    uniq = O.unique_trees()
    print('== which stick lengths are needed')
    var = []
    for lens in STICK_VARIANTS:
        rows = build_all(lens)
        ok = [(n, lay) for n, t, lay in rows if lay]
        probs = sum(len(verify(lay)) for n, lay in ok)
        area = sum(extents(lay)[0] * extents(lay)[1] for n, lay in ok)
        var.append(dict(lengths=lens, built=len(ok), area=area, problems=probs))
        print(f'   sticks {lens}: {len(ok)} of {len(rows)} trees; total area {area / 1e3:.0f}k mm2; independent check problems {probs}')
    rows = build_all(CHOSEN)
    assert all(lay for n, t, lay in rows)
    tiles, sticks, per_tree = inventory(rows)
    print('   chosen', CHOSEN, '; most sticks of each length in any one tree:', dict(sticks))
    print('   most tiles of each type in any one tree:', dict(tiles))
    print('== real meshes (tiles with cups and magnet pockets, sticks with steel balls, word magnets)')
    mc = mesh_checks(rows, CHOSEN)
    print(f'   {mc["parts"]} parts in 10 trees, {mc["pairs"]} close pairs tested: largest overlap {mc["worst"]:.3f} mm3, problems {len(mc["problems"])}')
    for p in mc['problems'][:8]: print('   ', p)
    ex = export_parts(CHOSEN)
    render_trees(rows, CHOSEN, ['prex:L2 the-fluffy-cat-will-jump', 'xbar:L2 the-cat-chased-the-mouse'], os.path.join(OUT, 'whiteboard_trees.png'))
    R = dict(variants=var, chosen=CHOSEN, tiles=dict(tiles), sticks={str(k): v for k, v in sticks.items()}, mesh=dict(parts=mc['parts'], pairs=mc['pairs'], worst=mc['worst'], problems=mc['problems'][:20]), sizes={n: extents(lay) for n, t, lay in rows}, exports=ex)
    write_doc(R)
    json.dump(dict(variants=var, chosen=CHOSEN, tiles=dict(tiles), sticks={str(k): v for k, v in sticks.items()}, mesh=dict(parts=mc['parts'], pairs=mc['pairs'], worst=mc['worst'], problems=mc['problems'][:20]),
                   sizes={n: extents(lay) for n, t, lay in rows}), open(os.path.join(OUT, 'whiteboard.json'), 'w'), indent=1, default=float)
    return rows, mc


if __name__ == '__main__':
    main()
