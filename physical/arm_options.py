#!/usr/bin/env python3
"""
How should the arm move? A comparison, from the game's own trees.

The hinged arm (ARMS.md, HINGE.md) has a problem: a child hung on a rigid plug
at the arm's tip tilts with the arm. This script compares ways of dealing with
that, on every distinct tree in the game:

  A. swinging arm, children assumed upright        (the earlier layout: an ideal)
  B. swinging arm, children tilt with it           (what a rigid plug really does)
  C. swinging arm with a swivel cartridge at the tip, so children hang plumb
  D. SLIDING arm: the child moves sideways and never tilts

and, for the swivel, works out how much torque it would have to hold.

Run from the repo root:  python3 physical/arm_options.py
"""
import itertools, json, math, os, statistics, sys
from collections import defaultdict
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import spokes as sp

OUT = os.path.join(HERE, 'out')
STEP, N_POS = 24.0, 3                 # slide: positions 0, 24, 48, 72 mm


def unique_trees():
    seen, out = set(), []
    for n, t in A.load_trees():
        if repr(t) in seen: continue
        seen.add(repr(t)); out.append((n, t))
    return out


def slide_design():
    """Left arms slide left, right arms slide right; the middle arm of a three-slot piece is fixed."""
    left = A.slide_settings([-STEP * i for i in range(N_POS + 1)])
    right = A.slide_settings([STEP * i for i in range(N_POS + 1)])
    D = {1: A.STUB, 2: right, 3: right}
    for ns in (2, 3):
        D[(ns, 0)] = left
        D[(ns, ns - 1)] = right
    D[(3, 1)] = A.slide_settings([0])
    return D


def verify_slide(parts):
    """Direct distance checks on a slide layout: bodies, stems, and the beam out to its carriage."""
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
            if uid != pu and g.distance(bg) < A.GAP - 0.01: bad.append('a beam too close to a body')
    for (g1, i1), (g2, i2) in itertools.combinations(stems, 2):
        if g1.distance(g2) < A.GAP - 0.01: bad.append('two stems too close')
    return bad


def size(parts):
    b = unary_union([g for k, g, i in parts if k not in ('arm',)]).bounds
    return b[2] - b[0], b[3] - b[1]


def tip_loads(uniq):
    """Torque of a child's subtree about the arm-tip pivot, hanging upright."""
    res, _ = A.evaluate(uniq, A.CHOSEN, 40.0)
    rows = []
    for name, ok, parts in res:
        bodies = {i[1]: (g.centroid, i[0]) for k, g, i in parts if k == 'body'}
        kids = defaultdict(list); arms = []
        for k, g, i in parts:
            if k == 'arm': kids[i[3]].append(i[4]); arms.append((g, i))
        sub = lambda u: [u] + [x for c in kids[u] for x in sub(c)]
        for g, (st, t, slot, pu, cu) in arms:
            if st.length < 30: continue
            (px, py), (ex, ey) = list(g.coords)
            net = 0.0; grams = 0.0
            for u in sub(cu):
                c, ty = bodies[u]
                m = H.MASS[len(sp.PORTS.get(ty, {}))]
                grams += m; net += m * H.G * (c.x - ex)
            rows.append(dict(tree=name, piece=t, grams=grams, net=abs(net)))
    return rows


# ---- drawing -----------------------------------------------------------------
def draw_slide_tree(parts, cats, ox, oy, s):
    b = unary_union([g for k, g, i in parts if k != 'arm']).bounds
    X = lambda x: ox + (x - b[0]) * s
    Y = lambda y: oy + (y - b[1]) * s
    out = []
    for k, g, i in parts:
        if k in ('beam', 'stem'):
            x0, y0, x1, y1 = g.bounds
            out.append(f'<rect x="{X(x0):.1f}" y="{Y(y0):.1f}" width="{(x1 - x0) * s:.1f}" height="{(y1 - y0) * s:.1f}" fill="#7a8296"/>')
    for k, g, i in parts:
        if k != 'body': continue
        shape = sp.split_type(i[0])[0]
        color = cats[shape]['color']
        x0, y0, x1, y1 = g.bounds
        out.append(f'<rect x="{X(x0):.1f}" y="{Y(y0):.1f}" width="{(x1 - x0) * s:.1f}" height="{(y1 - y0) * s:.1f}" rx="{s * 4:.1f}" fill="{color}" stroke="{sp.shade(color, -.4)}"/>')
        lab = sp.label(i[0]).replace(' (XP)', '*').replace(' (X′)', '')
        out.append(f'<text x="{(X(x0) + X(x1)) / 2:.1f}" y="{(Y(y0) + Y(y1)) / 2 + s * 3:.1f}" font-size="{s * 9:.1f}" font-weight="700" fill="#fff" text-anchor="middle" font-family="Helvetica,Arial,sans-serif">{lab}</text>')
    return '\n'.join(out), ((b[2] - b[0]) * s, (b[3] - b[1]) * s)


def figure(cats, res_swing, res_slide, names, path, s=0.78):
    cells = []
    for name in names:
        ps = next(p for n, ok, p in res_swing if n == name)
        pl = next(p for n, ok, p in res_slide if n == name)
        cells.append((name, ps, pl))
    W = 0
    cols = []
    for name, ps, pl in cells:
        a = draw_slide_tree(ps, cats, 0, 0, s)[1]; b = draw_slide_tree(pl, cats, 0, 0, s)[1]
        cols.append((a, b))
    pad = 30
    total_w = pad + sum(max(a[0], b[0]) + 2 * pad for a, b in cols) * 1
    row_h = max(max(a[1], b[1]) for a, b in cols) + 90
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(sum(a[0] + b[0] + 3 * pad for a, b in cols))}" height="{int(row_h + 60)}" font-family="Helvetica,Arial,sans-serif">',
           '<rect width="100%" height="100%" fill="#f7f8fb"/>',
           f'<text x="24" y="34" font-size="21" font-weight="700" fill="#222">The same trees with a swinging arm and with a sliding arm (to scale, {s:.2f} px per mm)</text>']
    x = pad
    for (name, ps, pl), (a, b) in zip(cells, cols):
        lab = name.replace('xbar:', "X′ · ").replace('prex:', 'XP · ').replace('L1 ', 'Level 1 ').replace('L2 ', '')
        sw = draw_swing_tree(ps, cats, x, 90, s)
        sl = draw_slide_tree(pl, cats, x + a[0] + pad, 90, s)[0]
        sz1 = size(ps); sz2 = size(pl)
        svg.append(f'<text x="{x}" y="62" font-size="14" font-weight="700" fill="#333">{lab}</text>')
        svg.append(f'<text x="{x}" y="80" font-size="12" fill="#667">swinging arm (children upright): {sz1[0]:.0f} × {sz1[1]:.0f} mm</text>')
        svg.append(f'<text x="{x + a[0] + pad}" y="80" font-size="12" fill="#667">sliding arm: {sz2[0]:.0f} × {sz2[1]:.0f} mm</text>')
        svg.append(sw); svg.append(sl)
        x += a[0] + b[0] + 3 * pad
    svg.append('</svg>')
    open(path, 'w').write('\n'.join(svg))


def draw_swing_tree(parts, cats, ox, oy, s):
    return A.draw_tree(parts, cats, ox, oy, s, show_angles=False)[0]


def main():
    cats, modes = sp.load()
    uniq = unique_trees()
    hinged = A.CHOSEN
    slide = slide_design()

    print('== the swivel: what it would have to hold')
    rows = tip_loads(uniq)
    net = sorted(r['net'] for r in rows)
    pc = lambda a, p: a[min(len(a) - 1, int(p * len(a)))]
    cover = {T: 100 * sum(1 for v in net if v <= T) / len(net) for T in (20, 60, 110, 230)}
    print(f'   {len(rows)} hinged arms; net torque of the child\'s subtree on the tip pivot: median {statistics.median(net):.0f}, 75% {pc(net, .75):.0f}, 90% {pc(net, .9):.0f}, max {net[-1]:.0f} N*mm')
    top = sorted(rows, key=lambda r: -r['net'])[:3]

    print('== layouts')
    A_res, _ = A.evaluate(uniq, hinged, 40.0)
    B_res, _ = A.evaluate(uniq, hinged, 40.0, tilt=True)
    C_res, _ = A.evaluate(uniq, hinged, 40.0, tip=True)
    D_res, _ = A.evaluate(uniq, slide, 40.0)
    E_res, _ = A.evaluate(uniq, slide, 40.0, park=True)
    table = []
    for (n, ok_a, pa), (_, ok_b, pb), (_, ok_c, pc_), (_, ok_d, pd), (_, ok_e, pe) in zip(A_res, B_res, C_res, D_res, E_res):
        row = dict(tree=n)
        for key, ok, p in (('A', ok_a, pa), ('B', ok_b, pb), ('C', ok_c, pc_), ('D', ok_d, pd), ('E', ok_e, pe)):
            row[key] = size(p) if ok else None
        row['D_problems'] = verify_slide(pd) if ok_d else ['not built']
        table.append(row)
        f = lambda v: 'cannot build' if v is None else f'{v[0]:.0f}x{v[1]:.0f}'
        print(f'   {n:<46} upright {f(row["A"]):>10} | tilt {f(row["B"]):>10} | swivel {f(row["C"]):>11} | slide {f(row["D"]):>9} | slide, unused left on {f(row["E"]):>9}')
    problems = [p for r in table for p in r['D_problems']]
    print(f'   slide layouts: independent check problems: {len(problems)}')
    figure(cats, A_res, D_res, ['xbar:L1 one-more-branch', 'xbar:L2 the-cat-chased-the-mouse'], os.path.join(OUT, 'arm_options.svg'))
    json.dump(dict(rows=table, tip_net=dict(median=statistics.median(net), p75=pc(net, .75), p90=pc(net, .9), max=net[-1]), slide=dict(step=STEP, positions=N_POS)),
              open(os.path.join(OUT, 'arm_options.json'), 'w'), indent=1, default=float)
    write_doc(table, net, cover, top, problems)
    if problems:
        sys.exit('SLIDE CHECK FAILED')
    print('done')


def write_doc(table, net, cover, top, problems):
    pc = lambda a, p: a[min(len(a) - 1, int(p * len(a)))]
    f = lambda v: '**cannot be built**' if v is None else f'{v[0]:.0f} × {v[1]:.0f}'
    n_ok = lambda k: sum(1 for r in table if r[k] is not None)
    L = ['# How should the arm move?\n',
         'Generated by `physical/arm_options.py` from the game\'s own trees. Figure: `physical/out/arm_options.png`.\n',
         'The swinging arm has a problem (STOW.md): a child on a rigid plug at the arm\'s tip tilts with the arm, and the trees sprawl. '
         'I was asked to design a **swivel at the arm tip** to keep children upright. Before building it I checked what it would cost, and '
         'compared it with an arm that **slides sideways** instead, since a slide cannot tilt anything.\n',
         '## The swivel\n',
         'A swivel is only worth it if it can hold the child upright against the torque of its own subtree. Torque of everything hanging under each of the '
         f'{len(net)} hinged arms, about the arm-tip pivot, hanging upright (piece masses are the same assumption as HINGE.md):\n',
         '| median | 75% of arms | 90% of arms | largest |', '|---|---|---|---|',
         f'| {statistics.median(net):.0f} N·mm | {pc(net, .75):.0f} | {pc(net, .9):.0f} | {net[-1]:.0f} |', '',
         f'The three worst are the top arms of the biggest trees: ' + ', '.join(f'{sp.label(r["piece"])} in "{r["tree"]}" ({r["grams"]:.0f} g, {r["net"]:.0f} N·mm)' for r in top) + '. '
         f'A detent holding 110 N·mm would keep {cover[110]:.0f}% of children upright, and 230 N·mm {cover[230]:.0f}%. That is exactly the range of the hinge detent (HINGE.md), '
         'so the swivel would be **the same cartridge again**, with a stem and the plug in place of the arm.\n',
         'That works mechanically, but it is heavy. A cartridge (about 25 mm wide, 28 mm of stem) on the tip of every hinged arm, laid out with the same arms:\n']
    L += ['| Tree | swinging arm, children upright (ideal) | children tilt (a rigid plug) | **swivel on every arm tip** | **sliding arm** | sliding, unused arms left on |', '|---|---|---|---|---|---|']
    for r in table:
        L.append(f'| {r["tree"].replace("prex:", "XP · ").replace("xbar:", "X′ · ")} | {f(r["A"])} | {f(r["B"])} | {f(r["C"])} | {f(r["D"])} | {f(r["E"])} |')
    L += ['', f'(sizes in mm.) With swivels, **{n_ok("C")} of {len(table)}** trees build: the biggest X′ tree no longer does, and the rest get about 20 to 30% taller. '
          'And there is still a second setting to make: when the arm is moved, the child has to be twisted back upright to the matching click. '
          'So the swivel works, but at a real price.\n',
          '## The sliding arm\n',
          f'Here the child moves sideways and hangs straight down from a stem. Nothing tilts, so nothing needs to keep it upright. '
          f'Left arms slide left and right arms slide right; the **middle arm of a three-slot piece does not move at all**. '
          f'Each moving arm has four positions: 0, {STEP:.0f}, {2 * STEP:.0f} and {3 * STEP:.0f} mm out. The child hangs {A.SLIDE_DROP:.0f} mm below the body.\n',
          f'It builds **{n_ok("D")} of {len(table)}** trees, and the independent distance check found {len(problems)} problems. '
          f'The trees are also much smaller than with swinging arms (the biggest X′ tree is {table[5]["D"][0]:.0f} × {table[5]["D"][1]:.0f} mm, '
          f'against {table[5]["A"][0]:.0f} × {table[5]["A"][1]:.0f} mm). And **unused arms can stay on** (last column): with {n_ok("E")} of {len(table)} trees building, '
          'the stowing problem mostly goes away too. I also tried smaller sets: three positions (0, 36, 72 mm) still build everything if the middle arm can move one step either way; two positions (0, 72) do not.\n',
          '![arm options](arm_options.png)\n',
          '## What the sliding model leaves out\n',
          'This is a layout test, not a mechanism, and it is simpler than reality in ways that matter:\n',
          '- **The beam\'s tail.** A bar that slides out one side has to stay engaged in the body, so a bar reaching 72 mm needs about 85 mm of length, and when retracted its tail pokes out the other side. '
          'The test only draws the beam out to the carriage. **This is now settled in `SLIDE.md`**: a fixed rail builds 3 of the 10 trees, a bar with a tail 7, and a two-stage telescope all 10.',
          '- **Beams of neighbouring pieces.** Beams are only checked against bodies and stems, not against each other.',
          '- **The 24 mm drop** between body and child is assumed, not designed.',
          '- **The detent.** A sliding arm only has to resist a few newtons along the slide (the weight of a hanging phrase tilted on its side), instead of a hundred N·mm of torque, '
          'so it should be much easier to print than the hinge, but it is not designed.',
          '- **Load on the beam.** The weight hangs off the end of a cantilever; at 72 mm out, 350 g is about 250 N·mm of bending, which a bar of this size carries, and the guide in the body has to resist it as a couple.\n',
          '## Where this leaves the earlier work\n',
          '- The **swinging arm and its hinge** (ARMS.md, HINGE.md, STOW.md) is a worked, checked design, but it needs the swivel to be correct, and the swivel is costly.',
          '- The **sliding arm** is designed in `SLIDE.md`: a two-stage telescoping dovetail slide, 4 printed parts and no screws, which builds all 10 trees.',
          '- The **keys and the quick-release idea** (SPOKES.md) are unaffected either way.']
    open(os.path.join(HERE, 'ARM_OPTIONS.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
