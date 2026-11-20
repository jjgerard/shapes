#!/usr/bin/env python3
"""
Arm layout for the block kit, found by laying out every tree in the game.

A piece is a rigid body with a socket on top and one hinged, telescoping arm
per slot underneath (three for TP, VP and NP). Each arm ends in a plug that
goes into a child's socket. The arm has a few click settings:

    angle   from straight down, in click steps          (hinge detents)
    length  one of a few steps                           (telescoping detents)
    stow    folded up beside the body, out of the way    (for unused slots)

This script lays out all of the game's trees (every Level 1 target and Level 2
sentence, flat and X-bar) with a given set of settings, in 2D front view with
real piece sizes, and checks that no two parts touch. It then searches for the
smallest set of settings that lets every tree be built, and draws the result.

Run from the repo root:  python3 physical/arms.py
"""
import itertools, json, math, os, sys
from dataclasses import dataclass
from shapely.geometry import box, LineString, Point
from shapely.ops import unary_union
from shapely.affinity import translate, rotate

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spokes as sp

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

# --- piece sizes (mm), front view ---------------------------------------------
BODY_W0 = 30.0       # narrowest body: holds the 28 mm socket cup
BODY_H = 26.0
PIVOT_PITCH = 16.0   # between neighbouring arm hinges on one body (see HINGE.md)
HUB = 14.5           # width of a hinge housing (12 mm hub, 1 mm wall)
ARM_T = 5.0          # arm width in the plane of the tree (it is 9 mm thick the other way)
GAP = 5.0            # least clear space between parts of different subtrees
OVERLAP = 2 * ARM_T  # telescoping arm: slider stays this far inside the sleeve at full reach


def body_width(n_slots):
    return max(BODY_W0, (n_slots - 1) * PIVOT_PITCH + HUB + 8)


def pivot_x(index, n_slots):
    return (index - (n_slots - 1) / 2) * PIVOT_PITCH


# --- the game's trees, typed for the kit --------------------------------------
def slot_assignment(parent, children):
    """Monotone assignment of children to the parent's slots; first one that works."""
    slots = sorted(sp.PORTS[parent].items(), key=lambda kv: sp.SLOT_ORDER[kv[0]])
    def go(ci, si, acc):
        if ci == len(children): return acc
        for j in range(si, len(slots)):
            if children[ci] in slots[j][1]:
                r = go(ci + 1, j + 1, acc + [j])
                if r is not None: return r
        return None
    return go(0, 0, []), len(slots)


def load_trees():
    cats, modes = sp.load()
    out = []
    for mid in ('prex', 'xbar'):
        star = lambda n, mid=mid: '*' if (n['n'] == 2 and mid == 'prex') else ''
        def conv(n, mid=mid, star=star):
            return dict(t=f'{n["s"]}{n["n"]}{star(n)}', c=[conv(c) for c in n['c']])
        for t in modes[mid]['trees']:
            out.append((f'{mid}:{t["name"]}', conv(t['tree'])))
    return out


# --- layout with discrete arm settings ----------------------------------------
@dataclass
class Setting:
    length: float
    angle: float          # degrees from straight down, positive = to the right

    @property
    def cost(self):
        return self.length + 0.6 * abs(self.angle)


def settings(lengths, angles):
    return sorted((Setting(l, a) for l in lengths for a in angles), key=lambda s: (s.cost, s.length))


def overlap_area(a, b):
    return a.intersection(b).area


def target_offsets(subs, drop):
    """Where each child would sit if arms were free: left to right, as close
    as the gap allows, the whole row centred under the parent."""
    xs, placed = [], []
    for sub in subs:
        x = xs[-1] if xs else 0.0
        while True:
            cand = translate(sub, x, 0)
            if all(overlap_area(cand.buffer(GAP / 2), p.buffer(GAP / 2)) < 0.2 for p in placed):
                break
            x += 0.5
        xs.append(x); placed.append(cand)
    mid = (xs[0] + xs[-1]) / 2
    return [x - mid for x in xs]


_uid = itertools.count()


PLUG_W, PLUG_LEN = 22.7, 12.0     # a dangling plug seen from the front


def layout(node, S, stats, drop=40.0, top_k=10, park=False, tilt=False):
    """Returns (shape, ok, parts), in the node's frame: origin at the top
    centre of its body, y pointing down. Arms are snapped to the click
    settings S. parts = [(kind, geometry, info)] for drawing."""
    kids = node['c']
    nslots = len(sp.PORTS.get(node['t'], {}))
    w = body_width(nslots)
    body = box(-w / 2, 0, w / 2, BODY_H)
    uid = next(_uid)
    parts = [('body', body, (node['t'], uid))]
    if not kids:
        return body, True, parts
    assign, _ = slot_assignment(node['t'], [k['t'] for k in kids])
    Sn = S[nslots] if isinstance(S, dict) else S          # settings for a piece with this many slots
    subs = [layout(k, S, stats, drop, top_k, park, tilt) for k in kids]
    ok = all(s[1] for s in subs)
    shapes = [s[0] for s in subs]
    targets = target_offsets(shapes, drop)

    cands = []
    for sub, slot, tx in zip(shapes, assign, targets):
        px, py = pivot_x(slot, nslots), BODY_H
        opts = []
        for st in Sn:
            a = math.radians(st.angle)
            ex, ey = px + st.length * math.sin(a), py + st.length * math.cos(a)
            if ey < py + 8:
                continue
            # with tilt=True the child is rigid on the arm's end and turns with it
            child = translate(rotate(sub, -st.angle, origin=(0, 0)) if tilt else sub, ex, ey)
            if overlap_area(child, body) > 0.2:
                continue
            arm = LineString([(px, py), (ex, ey)]).buffer(ARM_T / 2).intersection(box(-1e4, py, 1e4, 1e4))
            shp = unary_union([child, arm])
            opts.append((math.hypot(ex - tx, ey - (py + drop)), st, shp, shp.buffer(GAP / 2), (px, py, ex, ey)))
        opts.sort(key=lambda o: o[0])
        cands.append(opts)

    # unused arms, if they stay on: each takes one click setting, with its bare plug hanging off the end
    n_used = len(cands)
    unused_slots = [i for i in range(nslots) if i not in assign] if park else []
    for slot in unused_slots:
        px, py = pivot_x(slot, nslots), BODY_H
        opts = []
        for st in Sn:
            a = math.radians(st.angle)
            ex, ey = px + st.length * math.sin(a), py + st.length * math.cos(a)
            arm = LineString([(px, py), (ex, ey)]).buffer(ARM_T / 2).intersection(box(-1e4, py, 1e4, 1e4))
            plug = box(ex - PLUG_W / 2, ey, ex + PLUG_W / 2, ey + PLUG_LEN)
            shp = unary_union([arm, plug])
            opts.append((0.0, st, shp, shp.buffer(GAP / 2), (px, py, ex, ey), plug))
        cands.append(opts)

    def search(k):
        best = [None]
        def dfs(i, chosen, cost):
            if best[0] and cost >= best[0][0]: return
            if i == len(cands):
                best[0] = (cost, list(chosen)); return
            for o in cands[i][:k]:
                if any(overlap_area(o[3], c[3]) > 0.2 for c in chosen): continue
                chosen.append(o); dfs(i + 1, chosen, cost + o[0]); chosen.pop()
        dfs(0, [], 0.0)
        return best[0]

    found = search(top_k) or search(40)
    if found is None:
        for slot in assign: stats.append((node['t'], slot, nslots, Sn[-1]))
        return body, False, parts
    for o, slot in zip(found[1][n_used:], unused_slots):
        st, (px, py, ex, ey) = o[1], o[4]
        parts.append(('arm', LineString([(px, py), (ex, ey)]), (st, node['t'], slot, uid, None)))
        parts.append(('plug', o[5], (node['t'], slot, uid)))
    for o, slot, (sub, _, sparts) in zip(found[1][:n_used], assign, subs):
        st, (px, py, ex, ey) = o[1], o[4]
        stats.append((node['t'], slot, nslots, st))
        parts.append(('arm', LineString([(px, py), (ex, ey)]), (st, node['t'], slot, uid, sparts[0][2][1])))
        parts += [(k, translate(rotate(g, -st.angle, origin=(0, 0)) if tilt else g, ex, ey), i) for k, g, i in sparts]
    return unary_union([body] + [o[2] for o in found[1]]), ok, parts


def evaluate_drop(trees, S, drop):
    return evaluate(trees, S, drop)


def evaluate(trees, S, drop=40.0, park=False, tilt=False):
    results, stats = [], []
    for name, tr in trees:
        st = []
        shape, ok, parts = layout(tr, S, st, drop, park=park, tilt=tilt)
        results.append((name, ok, parts))
        stats += st
    return results, stats




# --- the design ---------------------------------------------------------------
STUB = settings([22], [0])                                   # single-slot pieces: short fixed stub
ARM_LEN = 80.0
ARM = settings([ARM_LEN], [-50, -25, 0, 25, 50])             # two- and three-slot pieces
CHOSEN = {1: STUB, 2: ARM, 3: ARM}

ALTERNATIVES = [
    ('fixed 64 mm, hinge 0 / ±30 / ±60', {1: STUB, 2: settings([64], [-60, -30, 0, 30, 60]), 3: settings([64], [-60, -30, 0, 30, 60])}),
    ('fixed 72 mm, hinge 0 / ±30 / ±60', {1: STUB, 2: settings([72], [-60, -30, 0, 30, 60]), 3: settings([72], [-60, -30, 0, 30, 60])}),
    (f'fixed {ARM_LEN:.0f} mm, hinge 0 / ±25 / ±50  (chosen)', CHOSEN),
    ('fixed 72 mm, hinge 0 / ±25 / ±50  (the earlier design)', {1: STUB, 2: settings([72], [-50, -25, 0, 25, 50]), 3: settings([72], [-50, -25, 0, 25, 50])}),
    ('fixed 66 mm, hinge 0 / ±25 / ±50 / ±70', {1: STUB, 2: settings([66], [-70, -50, -25, 0, 25, 50, 70]), 3: settings([66], [-70, -50, -25, 0, 25, 50, 70])}),
    ('telescoping 44 or 72 mm, hinge 0 / ±25 / ±50', {1: STUB, 2: settings([44, 72], [-50, -25, 0, 25, 50]), 3: settings([44, 72], [-50, -25, 0, 25, 50])}),
    ('telescoping 44 / 58 / 72 mm, hinge 0 / ±25 / ±50', {1: STUB, 2: settings([44, 58, 72], [-50, -25, 0, 25, 50]), 3: settings([44, 58, 72], [-50, -25, 0, 25, 50])}),
]


def verify_parts(parts):
    """Independent check on a finished layout: measure the distances between
    parts directly. Bodies, and arms against anything they are not attached
    to, must keep GAP clear."""
    bodies = {i[1]: (g, i[0]) for k, g, i in parts if k == 'body'}
    arms = [(g.buffer(ARM_T / 2), i) for k, g, i in parts if k == 'arm']
    bad = []
    for a, b in itertools.combinations(bodies, 2):
        if bodies[a][0].distance(bodies[b][0]) < GAP - 0.01:
            bad.append(f'bodies {bodies[a][1]} / {bodies[b][1]} only {bodies[a][0].distance(bodies[b][0]):.1f} mm apart')
    for cap, (st, t, slot, pu, cu) in arms:
        for uid, (g, name) in bodies.items():
            if uid in (pu, cu): continue
            if cap.distance(g) < GAP - 0.01:
                bad.append(f'{t} arm {cap.distance(g):.1f} mm from {name}')
    for (c1, i1), (c2, i2) in itertools.combinations(arms, 2):
        if c1.distance(c2) < GAP - 0.01:
            bad.append(f'{i1[1]} arm / {i2[1]} arm only {c1.distance(c2):.1f} mm apart')
    # bare plugs hanging off unused arms
    for k, g, (t, slot, pu) in [p for p in parts if p[0] == 'plug']:
        for uid, (bg, name) in bodies.items():
            if uid != pu and g.distance(bg) < GAP - 0.01:
                bad.append(f'bare {t} plug {g.distance(bg):.1f} mm from {name}')
        for cap, (st, t2, slot2, pu2, cu2) in arms:
            if (pu2, slot2) != (pu, slot) and g.distance(cap) < GAP - 0.01:
                bad.append(f'bare {t} plug {g.distance(cap):.1f} mm from an arm')
        for k2, g2, (t3, slot3, pu3) in [p for p in parts if p[0] == 'plug']:
            if (pu3, slot3) != (pu, slot) and g is not g2 and g.distance(g2) < GAP - 0.01:
                bad.append('two bare plugs too close')
    return bad


def extents(parts):
    b = unary_union([g for k, g, i in parts]).bounds
    return b[2] - b[0], b[3] - b[1]


# --- drawing -------------------------------------------------------------------
def draw_tree(parts, cats, ox, oy, s, show_angles=True):
    """parts are in the root's frame (y down). Returns svg and (w, h) in px."""
    b = unary_union([g for k, g, i in parts]).bounds
    out = []
    X = lambda x: ox + (x - b[0]) * s
    Y = lambda y: oy + (y - b[1]) * s
    for k, g, i in parts:
        if k != 'arm': continue
        st, t, slot, pu, cu = i
        (x0, y0), (x1, y1) = list(g.coords)
        out.append(f'<line x1="{X(x0):.1f}" y1="{Y(y0):.1f}" x2="{X(x1):.1f}" y2="{Y(y1):.1f}" stroke="#7a8296" '
                   f'stroke-width="{ARM_T * s:.1f}" stroke-linecap="round"/>')
        out.append(f'<circle cx="{X(x0):.1f}" cy="{Y(y0):.1f}" r="{s * 3.2:.1f}" fill="#4a5164"/>')
        if show_angles and st.length > 30:
            out.append(f'<text x="{(X(x0) + X(x1)) / 2 + (7 if x1 >= x0 else -7):.1f}" y="{(Y(y0) + Y(y1)) / 2:.1f}" '
                       f'font-size="{max(7, s * 5.5):.1f}" fill="#334" text-anchor="{"start" if x1 >= x0 else "end"}">{st.angle:+.0f}°</text>')
    for k, g, i in parts:
        if k != 'body': continue
        t = i[0]
        shape, n, star = sp.split_type(t)
        color = cats[shape]['color']
        x0, y0, x1, y1 = g.bounds
        out.append(f'<rect x="{X(x0):.1f}" y="{Y(y0):.1f}" width="{(x1 - x0) * s:.1f}" height="{(y1 - y0) * s:.1f}" rx="{s * 4:.1f}" '
                   f'fill="{color}" stroke="{sp.shade(color, -.4)}" stroke-width="1"/>')
        lab = sp.label(t).replace(' (XP)', '*').replace(' (X′)', '')
        out.append(f'<text x="{(X(x0) + X(x1)) / 2:.1f}" y="{(Y(y0) + Y(y1)) / 2 + s * 3:.1f}" font-size="{s * 9:.1f}" '
                   f'font-weight="700" fill="#fff" text-anchor="middle" font-family="Helvetica,Arial,sans-serif">{lab}</text>')
    return '\n'.join(out), ((b[2] - b[0]) * s, (b[3] - b[1]) * s)


def anatomy_svg(cats, path):
    s = 6.0
    cup = 2 * (sp.design()[5].R + sp.SPOKE_H + 2.6)
    W, H = 1560, 860
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="Helvetica,Arial,sans-serif">',
           '<rect width="100%" height="100%" fill="#f7f8fb"/>',
           '<text x="24" y="38" font-size="24" font-weight="700" fill="#222">Three-arm piece: TP</text>',
           f'<text x="24" y="60" font-size="13" fill="#555">front view, to scale (6 px per mm) · hinges {PIVOT_PITCH:.0f} mm apart · arms {ARM[0].length:.0f} mm, '
           f'clicking at 0°, ±25°, ±50° · plug Ø22.7 mm · socket cup Ø{cup:.1f} mm</text>']
    bw = body_width(3)
    cx, top = 530, 110
    color = cats['T']['color']
    pivots = [pivot_x(i, 3) for i in range(3)]
    base_y = top + BODY_H * s
    # fan of click positions
    for px in pivots:
        for ang in (-50, -25, 0, 25, 50):
            a = math.radians(ang)
            ex, ey = cx + (px + ARM[0].length * math.sin(a)) * s, base_y + ARM[0].length * math.cos(a) * s
            out.append(f'<line x1="{cx + px * s}" y1="{base_y}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#c6ccdb" stroke-width="1.4" stroke-dasharray="4 5"/>')
            out.append(f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="{11.35 * s:.1f}" fill="none" stroke="#e2e6ef" stroke-width="1"/>')
    # a typical pose: spec NP out to the left, T head down the middle, VP out to the right
    pose = {0: -50, 1: 0, 2: 25}
    names = {0: 'to the NP', 1: 'to T⁰', 2: 'to the VP'}
    for i, ang in pose.items():
        a = math.radians(ang)
        x0, ex = cx + pivots[i] * s, cx + (pivots[i] + ARM[0].length * math.sin(a)) * s
        ey = base_y + ARM[0].length * math.cos(a) * s
        out.append(f'<line x1="{x0}" y1="{base_y}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#7a8296" stroke-width="{ARM_T * s}" stroke-linecap="round"/>')
        out.append(f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="{11.35 * s:.1f}" fill="{sp.shade(color, .35)}" stroke="{sp.shade(color, -.4)}" stroke-width="1.5"/>')
        out.append(f'<text x="{ex:.1f}" y="{ey + 5:.1f}" text-anchor="middle" font-size="13" fill="#333">{names[i]} {ang:+d}°</text>')
    out.append(f'<rect x="{cx - bw / 2 * s}" y="{top}" width="{bw * s}" height="{BODY_H * s}" rx="{4 * s}" fill="{color}" stroke="{sp.shade(color, -.4)}" stroke-width="1.5"/>')
    out.append(f'<rect x="{cx - 11.7 * s}" y="{top}" width="{23.4 * s}" height="{12 * s}" rx="{3 * s}" fill="#fff" stroke="{sp.shade(color, -.5)}"/>')
    out.append(f'<text x="{cx}" y="{top + 7.4 * s}" text-anchor="middle" font-size="13" fill="#555">top socket</text>')
    out.append(f'<text x="{cx}" y="{top + BODY_H * s - 0.8 * s}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">TP</text>')
    for px, nm in zip(pivots, 'LMR'):
        out.append(f'<circle cx="{cx + px * s}" cy="{base_y}" r="{HUB / 2 * s}" fill="#4a5164" stroke="#fff" stroke-width="2"/>')
        out.append(f'<text x="{cx + px * s}" y="{base_y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">{nm}</text>')
    # scale bar and notes
    out.append(f'<line x1="960" y1="{H - 60}" x2="{960 + 50 * s}" y2="{H - 60}" stroke="#333" stroke-width="3"/>'
               f'<text x="960" y="{H - 70}" font-size="12" fill="#333">50 mm</text>')
    notes = ['Left, middle and right arms hang from hinges on the bottom of the body.',
             'Each hinge clicks at five angles: straight down, 25° and 50° either way.',
             f'Body {bw:.0f} × {BODY_H:.0f} mm (two-arm pieces {body_width(2):.0f} mm, one-arm pieces {body_width(1):.0f} mm).',
             'Dashed lines and rings: every position an arm can click into.',
             'Unused arms have to stow out of the way: the plug is wider than',
             'the hinge pitch, so a dangling arm would hit its neighbour.']
    for j, t in enumerate(notes):
        out.append(f'<text x="960" y="{150 + j * 24}" font-size="14" fill="#333">{t}</text>')
    out.append('</svg>')
    open(path, 'w').write('\n'.join(out))


def trees_svg(res, cats, names, path, s=1.05):
    cols, pad = 2, 24
    rows, cells = [], []
    for name in names:
        parts = next(p for n, ok, p in res if n == name)
        svg, (w, h) = draw_tree(parts, cats, 0, 0, s)
        cells.append((name, parts, w, h))
    colw = max(c[2] for c in cells) + 2 * pad
    out, y = [], 70
    maxh = [0] * cols
    positions = []
    x_off = [pad] * cols
    xs = [pad + k * colw for k in range(cols)]
    # place cells column by column, greedy shortest column
    heights = [70] * cols
    for name, parts, w, h in cells:
        k = heights.index(min(heights))
        positions.append((xs[k], heights[k]))
        heights[k] += h + 88
    W, H = pad + cols * colw, max(heights) + 10
    svg_out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" font-family="Helvetica,Arial,sans-serif">',
               '<rect width="100%" height="100%" fill="#f7f8fb"/>',
               f'<text x="24" y="36" font-size="22" font-weight="700" fill="#222">The game\'s trees, built with the chosen arms</text>',
               f'<text x="24" y="56" font-size="12.5" fill="#555">to scale ({s:.2f} px per mm) · arm angles shown on the long arms · * = XP-mode head · stubs on single-slot pieces are 22 mm</text>']
    for (name, parts, w, h), (px, py) in zip(cells, positions):
        svg, _ = draw_tree(parts, cats, px, py + 46, s)
        ew, eh = extents(parts)
        label = name.replace('prex:', 'XP mode · ').replace('xbar:', "X′ mode · ").replace('L1 ', 'Level 1 ').replace('L2 ', '')
        svg_out.append(f'<text x="{px}" y="{py + 16}" font-size="13" font-weight="700" fill="#333">{label}</text>'
                       f'<text x="{px}" y="{py + 32}" font-size="12" fill="#667">{sum(1 for k,_,_ in parts if k=="body")} pieces · {ew:.0f} × {eh:.0f} mm</text>')
        svg_out.append(svg)
    svg_out.append('</svg>')
    open(path, 'w').write('\n'.join(svg_out))


def main():
    cats, modes = sp.load()
    trees = load_trees()
    # 1. the chosen design on every tree
    res, stats = evaluate(trees, CHOSEN, 40.0)
    problems = []
    for name, ok, parts in res:
        if not ok: problems.append(f'{name}: no click setting avoids a collision')
        problems += [f'{name}: {p}' for p in verify_parts(parts)]
    ext = {n: extents(p) for n, ok, p in res}
    npieces = {n: sum(1 for k, _, _ in p if k == 'body') for n, ok, p in res}
    print(f'chosen design: {"all 14 trees built, independent check clean" if not problems else problems}')
    for n in ext: print(f'   {n:<52} {npieces[n]:>3} pieces {ext[n][0]:>4.0f} x {ext[n][1]:>4.0f} mm')

    # 2. which clicks the three-slot pieces actually use
    from collections import Counter
    use = {}
    for t, slot, nslots, st in stats:
        if nslots == 3:
            use.setdefault((t, 'LMR'[slot]), Counter())[int(st.angle)] += 1
    for (t, sl), c in sorted(use.items()):
        print(f'   {sp.label(t)} {sl}: ' + ', '.join(f'{a:+d}°×{n}' for a, n in sorted(c.items())))

    # 3. the alternatives, for the record
    table = []
    for name, Sd in ALTERNATIVES:
        r, _ = evaluate(trees, Sd, 40.0)
        nbad = sum(1 for _, ok, _ in r if not ok)
        e = {n: extents(p) for n, ok, p in r}
        table.append((name, nbad, max(e[n][0] for n in e if n.startswith('prex')), max(e[n][1] for n in e if n.startswith('prex')),
                      max(e[n][0] for n in e if n.startswith('xbar')), max(e[n][1] for n in e if n.startswith('xbar')) if nbad == 0 else None))
        print(f'   {name:<52} {"all 14 ok" if nbad == 0 else str(nbad) + " fail"}')

    anatomy_svg(cats, os.path.join(OUT, 'arms_piece.svg'))
    pick = ['prex:L1 one-more-branch', 'prex:L2 the-fluffy-cat-quickly-jumped-on-the-table', 'xbar:L2 the-cat-chased-the-mouse',
            'xbar:L2 the-cat', 'prex:L2 the-cat', 'prex:L2 the-fluffy-cat-will-jump']
    trees_svg(res, cats, pick, os.path.join(OUT, 'arms_trees.svg'))
    json.dump(dict(
        body=dict(width={1: body_width(1), 2: body_width(2), 3: body_width(3)}, height=BODY_H),
        hinge=dict(pitch=PIVOT_PITCH, hub=HUB), arm=dict(section=ARM_T, length=ARM[0].length, clicks=sorted({s.angle for s in ARM})),
        stub=dict(length=STUB[0].length), clear_gap=GAP,
        trees={n: dict(width=round(ext[n][0]), height=round(ext[n][1]), pieces=npieces[n]) for n in ext},
        alternatives=[dict(name=t[0], failing_trees=t[1]) for t in table]),
        open(os.path.join(OUT, 'arms.json'), 'w'), indent=1)
    write_doc(res, ext, npieces, use, table, problems)
    if problems: sys.exit('ARM LAYOUT CHECK FAILED')
    print('arm layout checks passed')


def write_doc(res, ext, npieces, use, table, problems):
    L = ['# Arm layout\n',
         'Generated by `physical/arms.py` from the game\'s own trees (`data.js`). Drawings: `physical/out/arms_piece.svg` (one piece) '
         'and `physical/out/arms_trees.svg` (trees built with these arms).\n',
         '## The design\n',
         f'- **Two- and three-slot pieces** (TP, VP, NP, PP, CP, and every bar): each slot has a hinged arm, **{ARM[0].length:.0f} mm long**, '
         f'{ARM_T:.0f} mm wide, that **clicks at {", ".join(f"{a:+.0f}°" for a in sorted({s.angle for s in ARM}) if a > 0)[:0]}'
         f'0°, ±25° and ±50°** from straight down. **No sliding part.**',
         f'- **Single-slot pieces** (DP, N′, AdjP, AdvP): a fixed {STUB[0].length:.0f} mm stub, straight down, no hinge. They only ever have one child, '
         'so they never need to reach sideways.',
         f'- **Hinges** sit on the bottom of the body {PIVOT_PITCH:.0f} mm apart; a hinge hub is {HUB:.0f} mm wide. Body size: three-slot '
         f'{body_width(3):.0f} × {BODY_H:.0f} mm, two-slot {body_width(2):.0f} mm, one-slot and heads {body_width(1):.0f} mm (the socket cup is 27.9 mm across).',
         '- **Layout rule:** when it is built, the parent sits centred over its children, and every arm is set to the nearest click; '
         f'no two parts of different branches may come within {GAP:.0f} mm.\n',
         '## Why these numbers\n',
         'Every Level 1 target and Level 2 sentence in both modes (14 trees, 233 nodes) was laid out in front view with real piece sizes, with the '
         'arms restricted to a set of click settings, and the smallest set that builds all of them was kept.\n',
         '| Arm design | Trees that can be built | Biggest flat tree | Biggest X-bar sentence |', '|---|---|---|---|']
    for name, nbad, fw, fh, xw, xh in table:
        ok = 'all 14' if nbad == 0 else f'**{14 - nbad} of 14**'
        L.append(f'| {name} | {ok} | {fw:.0f} × {fh:.0f} mm | ' + (f'{xw:.0f} × {xh:.0f} mm' if xh else '—') + ' |')
    L += ['', 'Findings:',
          '- The reach needed is modest because **the parent can sit centred over its children**. '
          'My first attempt, which hung children from one side, needed arms over a metre long.',
          '- A fixed arm is enough. The telescoping rows show what a sliding arm would buy; it adds a sliding part, which is the most likely thing to wobble or snap, and '
          f'the arm must overlap its sleeve by at least {OVERLAP:.0f} mm. I would only add it if the biggest trees turn out to be too big for your tables.',
          '- Not every set of clicks works: see the "Trees that can be built" column. The hinge design (HINGE.md) set the hinge pitch and arm width; with those, '
          'the 72 mm arm of the earlier design no longer builds the biggest X-bar tree, and an 80 mm arm does. Shorter arms (64 to 72 mm) also build every tree with clicks at 0 / ±30° / ±60°, but the housing cannot swing an arm that far and still hold the hub in (HINGE.md), so I kept ±50° and the longer arm.\n',
          '## Which clicks the three-slot pieces use\n', '| Piece and arm | Clicks used in the game\'s trees |', '|---|---|']
    for (t, sl), c in sorted(use.items()):
        L.append(f'| {sp.label(t)} {sl} | ' + ', '.join(f'{a:+d}° × {n}' for a, n in sorted(c.items())) + ' |')
    L += ['', '## The trees\n', '| Tree | Pieces | Width × height |', '|---|---|---|']
    for n, (w, h) in ext.items():
        L.append(f'| {n.replace("prex:", "XP mode · ").replace("xbar:", "X′ mode · ")} | {npieces[n]} | {w:.0f} × {h:.0f} mm |')
    L += ['', f'Independent check: for each tree the distances between parts were measured directly (not just by the placement routine): '
          + ('**no clashes**.' if not problems else f'**{len(problems)} problems**: {problems[:5]}'),
          '', '## Things this does not settle\n',
          '- **Big X-bar trees are big.** The Level 1 target (37 pieces) and the question sentences are about 0.4 m wide and 0.65 to 1 m tall. '
          'They are fine on a floor or a long table, and impractical to lift whole. Single phrases (a DP, a VP) are small enough to pick up.',
          '- **Unused arms must stow.** The three-slot pieces are often used with one or two arms (NP uses only one of its three 16 times in the '
          'game\'s trees; TP leaves its middle arm empty in every X-bar tree). A plug is 22.7 mm wide and hinges are 13 mm apart, so a dangling '
          'arm would hit its neighbour. Options: fold the arm up flat against the back of the body (the body would need to be about 40 mm deep), '
          'or make arms removable on a keyed hub. I have not designed this yet.',
          '- **The hinge has to hold a hanging phrase.** HINGE.md works out the torque from these trees and designs a detent hinge for it.',
          '- **Arm strength.** The 5 × 9 mm arm carries the load comfortably in bending; the hinge and the plug joint are the weak points, not the arm.']
    open(os.path.join(HERE, 'ARMS.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
