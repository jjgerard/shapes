#!/usr/bin/env python3
"""
What to do with the arms a piece is not using.

The three-slot pieces (TP, VP, NP) very often use one or two of their three
arms, so this is not a corner case. This script

  1. counts how many arms go unused in the game's own trees,
  2. tests the cheapest answer, leaving every unused arm on and clicked out of
     the way with its bare plug hanging, by laying every tree out again with
     those arms present,
  3. designs the robust answer: an arm that snaps into the hub and comes off
     with a firm pull (hub with a socket, arm with a split tongue and two
     barbs), builds the parts, and checks the real meshes,
  4. measures a problem found along the way: a child hung on a rigid plug tilts
     with its arm, which the arm layout had assumed it did not.

Run from the repo root:  python3 physical/stow.py
"""
import json, math, os, sys
from collections import Counter, defaultdict
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon
from trimesh.boolean import union, difference, intersection
from shapely.geometry import Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import spokes as sp

OUT = os.path.join(HERE, 'hinge')
os.makedirs(OUT, exist_ok=True)
ENGINE = 'manifold'

# --- the quick-release joint (mm) ---------------------------------------------
Z0, Z1 = 2.0, 10.0            # arm thickness along the hub axis (8 mm), centred in the 12 mm hub
ARM_W = H.ARM_W               # 5 mm in the plane of the tree
CLR_X = 0.10                  # socket clearance each side
W_S = ARM_W / 2 + CLR_X       # socket half-width
TIP = 3.0                     # tongue tip, past the hub centre
SOCKET_TIP = TIP + 0.2
Y_ROOT = -5.0                 # where the slit between the prongs ends
Y_B = 1.0                     # barb position along the tongue
DELTA_B = 0.35                # barb height
TANB = 0.55                   # barb flank slope
PRONG_T = [1.5, 1.3, 1.1]     # prong thickness variants (slit = arm width - 2 x this)
HOLE_Y = -(H.ARM_LEN - 7.0)


def barb(sx):
    lb = DELTA_B / TANB
    pts = [(sx * (ARM_W / 2 - 0.02), Y_B - lb), (sx * (ARM_W / 2 + DELTA_B), Y_B), (sx * (ARM_W / 2 - 0.02), Y_B + lb)]
    m = extrude_polygon(Polygon(pts), Z1 - Z0, engine='earcut')
    m.apply_translation([0, 0, Z0])
    return H.fix(m)


def dimple(sx):
    lb = DELTA_B / TANB
    pts = [(sx * (W_S - 0.02), Y_B - lb - 0.15), (sx * (W_S + DELTA_B + 0.12), Y_B), (sx * (W_S - 0.02), Y_B + lb + 0.15)]
    m = extrude_polygon(Polygon(pts), (Z1 - Z0) + 0.2, engine='earcut')
    m.apply_translation([0, 0, Z0 - 0.1])
    return H.fix(m)


def hub_q():
    """The hub with a socket for the arm, and a dimple in each socket wall."""
    body = H.cyl(H.R_H, 0, H.L_H)
    cuts = []
    for a in H.CLICKS:
        phi = 90 - a
        cuts += [H.groove(H.L_H, +1, phi), H.groove(0.0, -1, phi)]
    cuts.append(H.slab(-W_S, W_S, -H.R_H - 1.0, SOCKET_TIP, Z0 - 0.1, Z1 + 0.1))
    cuts += [dimple(1), dimple(-1)]
    return H.fix(difference([body] + cuts, engine=ENGINE))


def arm_q(t_p):
    """The arm: a bar with a concave seat against the hub, and a split tongue with two barbs."""
    shoulder = H.slab(-ARM_W / 2, ARM_W / 2, -H.ARM_LEN, -4.0, Z0, Z1)
    shoulder = difference([shoulder, H.cyl(H.R_H + 0.05, Z0 - 1, Z1 + 1)], engine=ENGINE)
    tongue = H.slab(-ARM_W / 2, ARM_W / 2, -H.R_H - 1.0, TIP, Z0, Z1)
    slit = H.slab(-(ARM_W / 2 - t_p), ARM_W / 2 - t_p, Y_ROOT, TIP + 1.0, Z0 - 1, Z1 + 1)
    tongue = difference([tongue, slit], engine=ENGINE)
    arm = union([shoulder, tongue, barb(1), barb(-1)], engine=ENGINE)
    return H.fix(difference([arm, H.cyl(2.0, Z0 - 1, Z1 + 1, 0.0, HOLE_Y, 48)], engine=ENGINE))


# --- the mechanics of the snap -------------------------------------------------
def snap(t_p, mu):
    L = Y_B - Y_ROOT                                       # prong length from its root to the barb
    k = H.E_PETG * (Z1 - Z0) * t_p ** 3 / (4 * L ** 3)     # N/mm, one prong
    d = DELTA_B - CLR_X                                    # how far a barb has to push its prong in
    sigma = 3 * H.E_PETG * t_p * d / (2 * L ** 2)
    pull = 2 * k * d * (TANB + mu) / (1 - mu * TANB)
    return dict(t=t_p, k=k, d=d, sigma=sigma, strain=100 * sigma / H.E_PETG, pull=pull)


def torque_capacity():
    """Moment the tongue can pass to the hub through its side walls (couple over the socket depth)."""
    arm_len_in_socket = SOCKET_TIP - (-H.R_H)
    return arm_len_in_socket


# --- checks on the real meshes --------------------------------------------------
def turned_pair(hub, arm, deg):
    return H.turned(hub, deg), H.turned(arm, deg)


def run_checks(hub, arm, hsg_q, plate_top, plate_bot):
    out = {}
    # (a) the hub with its arm on turns freely through the swing
    free = {}
    for a in range(-60, 61, 5):
        h, r = turned_pair(hub, arm, a)
        free[a] = sum(H.overlap(m, g) for m in (h, r) for g in (hsg_q, plate_top, plate_bot))
    out['free_turn'] = free
    # (b) pushing the arm in: interference of the barbs with the socket walls, by insertion depth
    depths = [-20 + 0.25 * i for i in range(0, 81)]          # s = 0 is seated; negative is out
    curve = []
    for s in depths:
        m = arm.copy(); m.apply_translation([0, s, 0])
        curve.append(H.overlap(m, hub))
    out['insertion'] = (depths, curve)
    # (c) taking the arm off at three clicks: its way out is clear of the housing and lids
    way = {}
    for a in (-50, 0, 50):
        worst = 0.0
        for d in range(0, 26, 2):
            m = H.turned(arm, a)
            ax = (math.sin(math.radians(a)), -math.cos(math.radians(a)))
            m.apply_translation([ax[0] * d, ax[1] * d, 0])
            worst = max(worst, H.overlap(m, hsg_q) + H.overlap(m, plate_top) + H.overlap(m, plate_bot))
        way[a] = worst
    out['way_out'] = way
    return out


def section_figure(hub, arm, hsg, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MPoly
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union as uu
    sys.path.insert(0, HERE)
    import coupon as C

    def section_xy(m, z):
        segs = trimesh.intersections.mesh_plane(m, [0, 0, 1], [0, 0, z])
        r = lambda v: round(float(v), 5)
        lines = [LineString([(r(p[0][0]), r(p[0][1])), (r(p[1][0]), r(p[1][1]))]) for p in segs]
        return uu(list(polygonize(uu(lines))))

    fig = plt.figure(figsize=(21, 5.6), facecolor='white')
    gs = fig.add_gridspec(1, 4, width_ratios=[1, 1, 1, 1.5])
    for i, (title, m) in enumerate([('hub with socket', hub), ('arm (prongs 1.3 mm)', arm), ('housing, slot raised for the thicker arm', hsg)]):
        ax = fig.add_subplot(gs[0, i])
        ax.imshow(C.render(m, w=520, h=520, elev=26.0, azim=-58.0)); ax.set_axis_off(); ax.set_title(title, fontsize=12)
    ax = fig.add_subplot(gs[0, 3])
    for m, col in ((hsg, '#b9c0cc'), (hub, '#2f5db8'), (arm, '#e67e22')):
        g = section_xy(m, 6.0)
        for p in (g.geoms if hasattr(g, 'geoms') else [g]):
            if p.is_empty: continue
            ax.add_patch(MPoly(list(p.exterior.coords), closed=True, facecolor=col, edgecolor='#223', lw=0.8))
            for h in p.interiors:
                ax.add_patch(MPoly(list(h.coords), closed=True, facecolor='white', edgecolor='#223', lw=0.8))
    ax.set_xlim(-14, 14); ax.set_ylim(-20, 14); ax.set_aspect('equal'); ax.set_xlabel('x (mm)'); ax.set_ylabel('y (mm)')
    ax.set_title('cut across the hub at mid-height, arm seated', fontsize=12)
    ax.annotate('barb in its dimple', (2.8, Y_B), (6.5, 6.5), fontsize=9, arrowprops=dict(arrowstyle='->'))
    ax.annotate('slit between the prongs', (0, -2.0), (4.5, -8.5), fontsize=9, arrowprops=dict(arrowstyle='->'))
    ax.annotate('arm seats on the hub rim', (0, -6.3), (-13, -11), fontsize=9, arrowprops=dict(arrowstyle='->'))
    fig.tight_layout(); fig.savefig(path, dpi=110)


# --- counting unused arms, and the layout experiments ---------------------------
def count_unused(trees):
    rows = []
    for name, tr in trees:
        used = unused = 0
        def walk(n):
            nonlocal used, unused
            ns = len(sp.PORTS.get(n['t'], {}))
            if ns >= 2:
                used += len(n['c']); unused += ns - len(n['c'])
            for c in n['c']: walk(c)
        walk(tr)
        rows.append((name, used, unused))
    return rows


def pattern_table(trees):
    pat = Counter()
    for name, tr in trees:
        def walk(n):
            ns = len(sp.PORTS.get(n['t'], {}))
            if ns >= 2:
                assign, _ = A.slot_assignment(n['t'], [k['t'] for k in n['c']])
                names = 'LMR' if ns == 3 else 'LR'
                pat[(sp.label(n['t']), ''.join(names[i] for i in assign), ns)] += 1
            for c in n['c']: walk(c)
        walk(tr)
    return pat


def layout_experiments(trees):
    S = A.CHOSEN
    base, _ = A.evaluate(trees, S, 40.0)
    park, _ = A.evaluate(trees, S, 40.0, park=True)
    tilt, _ = A.evaluate(trees, S, 40.0, tilt=True)
    rows = []
    for (n, ok0, p0), (_, ok1, p1), (_, ok2, p2) in zip(base, park, tilt):
        b = unary_union([g for k, g, i in p0]).bounds
        row = dict(tree=n, base=(b[2] - b[0], b[3] - b[1]))
        if ok1:
            q = unary_union([g for k, g, i in p1]).bounds
            row['park'] = (q[2] - q[0], q[3] - q[1]); row['park_problems'] = A.verify_parts(p1)
            row['park_clicks'] = [(sp.label(i[1]), i[2], int(i[0].angle)) for k, g, i in p1 if k == 'arm' and i[4] is None]
        else:
            row['park'] = None
        if ok2:
            q = unary_union([g for k, g, i in p2]).bounds
            row['tilt'] = (q[2] - q[0], q[3] - q[1])
        else:
            row['tilt'] = None
        rows.append(row)
    return rows


def main():
    trees_all = A.load_trees()
    seen, uniq = set(), []
    for n, t in trees_all:
        if repr(t) in seen: continue
        seen.add(repr(t)); uniq.append((n, t))
    print('== unused arms')
    cnt = count_unused(uniq)
    tot_used = sum(u for _, u, _ in cnt); tot_unused = sum(x for _, _, x in cnt)
    print(f'   {len(uniq)} distinct trees: {tot_used} hinged arms used, {tot_unused} unused ({100 * tot_unused / (tot_used + tot_unused):.0f}%)')
    pat = pattern_table(uniq)
    print('== leave them on, parked out of the way, and the tilting question')
    rows = layout_experiments(uniq)
    for r in rows:
        f = lambda v: 'CANNOT BUILD' if v is None else f'{v[0]:.0f} x {v[1]:.0f}'
        print(f'   {r["tree"]:<46} base {f(r["base"]):>12} | arms left on {f(r["park"]):>12} | children tilt {f(r["tilt"]):>12}')
    n_park_fail = sum(1 for r in rows if r['park'] is None)
    park_problems = [p for r in rows if r['park'] for p in r['park_problems']]

    print('== the snap-in arm')
    tbl = []
    for t in PRONG_T:
        row = dict(t=t, slit=ARM_W - 2 * t, **{f'p{int(mu * 100)}': snap(t, mu)['pull'] for mu in (0.0, 0.3, 0.45)})
        s = snap(t, 0.3); row.update(k=s['k'], sigma=s['sigma'], strain=s['strain'], d=s['d'])
        tbl.append(row)
        print(f'   prongs {t} mm: k {s["k"]:.0f} N/mm each, push {s["d"]:.2f} mm, stress {s["sigma"]:.0f} MPa ({s["strain"]:.1f}%), pull-off {row["p0"]:.0f} / {row["p30"]:.0f} / {row["p45"]:.0f} N (mu 0 / .3 / .45)')

    hub = hub_q(); arm13 = arm_q(1.3)
    hsg = H.housing(slot_top=Z1 + 0.4)
    lid = H.lid_installed(H.T_DESIGN, with_nose=False)
    plate_top, plate_bot = lid, H.mirrored_bottom(lid)
    meshes = {'hub_q': hub, 'housing_q': hsg}
    for t in PRONG_T:
        meshes[f'arm_q{int(round(t * 10)):02d}'] = arm13 if t == 1.3 else arm_q(t)
    health = {k: H.health(m) for k, m in meshes.items()}
    for k, m in meshes.items():
        m.export(os.path.join(OUT, f'hinge_{k}.stl')); print(f'   {k}: {health[k]}')

    chk = run_checks(hub, arm13, hsg, plate_top, plate_bot)
    fails = []
    bad = [k for k, h in health.items() if not (h['watertight'] and h['volume'])]
    if bad: fails.append(f'bad meshes {bad}')
    inside = max(v for a, v in chk['free_turn'].items() if abs(a) <= 55)
    beyond = [chk['free_turn'][a] for a in (-60, 60)]
    print(f'   turning with the arm on: overlap within +-55 degrees {inside:.3f} mm3; at +-60 {[round(v, 2) for v in beyond]}')
    if inside > 0.01: fails.append('the arm or hub touches the housing within the swing')
    if not all(v > 0.01 for v in beyond): fails.append('the slot-limit check is not sensitive')
    depths, curve = chk['insertion']
    seated = curve[depths.index(0.0)]
    peak = max(curve)
    away = max(c for d, c in zip(depths, curve) if d <= -13.0)
    d_eff = DELTA_B - CLR_X
    pred = 2 * (Z1 - Z0) * 0.5 * (2 * d_eff / TANB) * d_eff
    print(f'   pushing the arm in: seated {seated:.3f} mm3, clear of the hub when {13} mm out ({away:.3f}); peak barb interference {peak:.2f} mm3 (predicted {pred:.2f})')
    if seated > 0.05: fails.append(f'the arm interferes with the socket when seated ({seated:.2f} mm3)')
    if away > 0.01: fails.append('the arm is still touching the hub 13 mm out')
    if abs(peak - pred) / pred > 0.15: fails.append(f'barb interference {peak:.2f} does not match the prediction {pred:.2f}')
    print('   taking it off at three clicks, overlap with housing and lids:', {a: round(v, 3) for a, v in chk['way_out'].items()})
    if max(chk['way_out'].values()) > 0.01: fails.append('the arm cannot be pulled out cleanly at some click')

    section_figure(hub, arm13, hsg, os.path.join(OUT, 'quick_release.png'))
    write_doc(cnt, tot_used, tot_unused, pat, rows, tbl, chk, peak, pred, fails, n_park_fail, park_problems, len(uniq))
    json.dump(dict(unused=dict(used=tot_used, unused=tot_unused), snap=tbl,
                   leave_on=[dict(tree=r['tree'], base=r['base'], park=r['park'], tilt=r['tilt']) for r in rows]),
              open(os.path.join(OUT, 'stow.json'), 'w'), indent=1, default=float)
    if fails:
        print('FAILED:', *fails, sep='\n  '); sys.exit(1)
    print('all stow checks passed')


def write_doc(cnt, tot_used, tot_unused, pat, rows, tbl, chk, peak, pred, fails, n_park_fail, park_problems, ntrees):
    f = lambda v: '**cannot be built**' if v is None else f'{v[0]:.0f} × {v[1]:.0f} mm'
    L = ['# Unused arms\n',
         'Generated by `physical/stow.py`. Parts: `physical/hinge/hinge_hub_q.stl`, `hinge_housing_q.stl`, `hinge_arm_q15.stl`, `hinge_arm_q13.stl`, `hinge_arm_q11.stl`. '
         'Figure: `physical/hinge/quick_release.png`.\n',
         '## How common it is\n',
         f'In the game\'s {ntrees} distinct trees, the hinged arms on the two- and three-slot pieces are used **{tot_used}** times and left **unused {tot_unused}** times '
         f'({100 * tot_unused / (tot_used + tot_unused):.0f}% of them). The unused ones are almost all on the three-slot pieces:\n',
         '| Piece | slots used | times it appears |', '|---|---|---|']
    for (t, used, ns), c in sorted(pat.items(), key=lambda kv: (-kv[0][2], kv[0][0], kv[0][1])):
        if len(used) < ns:
            L.append(f'| {t} ({ns} slots) | {used or "(none)"} | {c} |')
    L += ['', 'A dangling arm is 80 mm long and ends in a bare plug 22.7 mm wide, so it can hit a neighbour. '
          'A folded-back arm is not possible (the hinge turns ±50° and its slot opens ±82°). Two answers:\n',
          '## Option 1: leave the arm on and click it out of the way\n',
          'No hardware at all. Every tree was laid out again with the unused arms present, each clicked to whichever of the five positions keeps it clear, '
          'and its bare plug hanging off the end:\n',
          '| Tree | arms absent | arms left on |', '|---|---|---|']
    for r in rows:
        L.append(f'| {r["tree"].replace("prex:", "XP · ").replace("xbar:", "X′ · ")} | {f(r["base"])} | {f(r["park"])} |')
    clicks = defaultdict(Counter)
    for r in rows:
        for t, slot, ang in r.get('park_clicks', []):
            clicks[t][ang] += 1
    L += ['', f'It works for **{ntrees - n_park_fail} of {ntrees}** trees, with trees up to about 40 mm wider. '
          'The unused arms click to the outside (left arms to −50° or −25°, right to +25°) and middle arms to 0° or −25°. '
          + ('The independent distance check found no clashes.' if not park_problems else f'The independent check found {len(park_problems)} clashes.'),
          f'The {n_park_fail} that fail are the biggest X′ trees. The failure is at the root, CP: the parked arms deep in its subtrees stick out far enough that CP\'s own two arms '
          '(80 mm at ±50°) can no longer spread its children apart. Taking those unused arms off fixes it.\n',
          '## Option 2: arms that snap in and come off\n',
          'Because it works for most trees and not all, and because a bare plug hanging off an arm will snag, the kit should also let any unused arm be removed. '
          'Every arm is the same part, so this also means a three-slot piece does not need three arms.\n',
          '**The joint.** The hub has a rectangular socket cut in from its rim, running past its centre. The arm\'s root is a tongue split down the middle into two prongs, '
          'each with a small barb on its outer face; the barbs click into dimples in the socket walls. The arm seats against the hub rim on a concave shoulder, '
          'so it always goes in to the same depth. Because the tongue is square, the arm cannot turn in the hub: the hinge torque passes through the socket walls, '
          'and the detent grooves are on the hub\'s end faces, clear of the socket.\n',
          f'| | |', '|---|---|',
          f'| arm | {H.ARM_W:.0f} mm wide × {Z1 - Z0:.0f} mm thick, {H.ARM_LEN:.0f} mm from the hinge axis (the arm in the hinge test was 9 mm thick; this one is 8 so the socket clears the grooves) |',
          f'| socket | {2 * W_S:.1f} × {Z1 - Z0 + 0.2:.1f} mm, from the hub rim to {SOCKET_TIP:.1f} mm past the axis |',
          f'| barbs | {DELTA_B} mm high, flank slope {TANB}, {Z1 - Z0:.0f} mm long; each has to push its prong in by {DELTA_B - CLR_X:.2f} mm to get past the socket wall |',
          '| housing | the arm slot is 1 mm higher (`hinge_housing_q.stl`) |', '',
          'How hard it pulls off is set by the prong thickness; three arms are provided to find the right feel (calculated for printed PETG, μ = friction):\n',
          '| Prong thickness | slit | stiffness each | stress | strain | pull-off at μ 0 | μ 0.3 | μ 0.45 |', '|---|---|---|---|---|---|---|---|']
    for r in tbl:
        L.append(f'| {r["t"]} mm | {r["slit"]:.1f} mm | {r["k"]:.0f} N/mm | {r["sigma"]:.0f} MPa | {r["strain"]:.1f}% | {r["p0"]:.0f} N | {r["p30"]:.0f} N | {r["p45"]:.0f} N |')
    L += ['', 'What it has to resist is the weight of a hanging phrase pulling along the arm, a few newtons (the heaviest, 350 g, is 3.4 N), so about 10 to 15 N of pull-off is comfortable and a hand can still do it. '
          'These are **calculated, not measured**, and the barb is only 0.35 mm high, which is small for a 0.4 mm nozzle; the three thicknesses are there to find out.\n',
          '![quick release](quick_release.png)\n',
          '### What the script checked on the real meshes\n',
          f'- All five parts are watertight solids.',
          f'- With the arm on, **the hub still turns freely through ±55°** (overlap {max(v for a, v in chk["free_turn"].items() if abs(a) <= 55):.3f} mm³) and touches at ±60°.',
          f'- Pushing the arm in, the barbs interfere with the socket walls by **{peak:.2f} mm³ at most** (predicted from the barb shape: {pred:.2f}); '
          'seated, there is no interference; 13 mm out the arm is clear of the hub.',
          f'- At the −50°, 0° and +50° clicks the arm can be **pulled straight out with nothing in the way** (overlap with housing and lids {max(chk["way_out"].values()):.3f} mm³).\n',
          '## A problem found on the way: children tilt with their arm\n',
          'The arm layout assumed that a child hangs **upright** from the end of its arm. A plug that is fixed to the arm would instead tilt the child by the arm\'s angle, and its own arms with it. '
          'The same trees laid out with rigid, tilting children:\n',
          '| Tree | children stay upright | children tilt with the arm |', '|---|---|---|']
    for r in rows:
        L.append(f'| {r["tree"].replace("prex:", "XP · ").replace("xbar:", "X′ · ")} | {f(r["base"])} | {f(r["tilt"])} |')
    L += ['', 'They still lay out without collisions, but the trees sprawl and bend sideways (the biggest becomes about 1.2 m square) and stop looking like the trees in the game. '
          'So the arm-end joint cannot be a rigid plug. The natural fix is a **swivel at the arm tip** that carries the plug, so a hanging child stays plumb (and can be given a light detent at upright). '
          'That is a design of its own, and it changes how the arm ends.\n',
          '## What this does not settle\n',
          '- **Strength.** FORTIFY.md found that the hub walls beside this socket are far too thin as built (safety factor 0.06 to 0.19 under a 15 N shove on the arm) and gives a fortified version (24 mm hub, 12 mm arm). Use that version, not the parts above.',
          '- **The tilt problem above.** It matters more than stowing; every layout result in `ARMS.md` assumes upright children.',
          '- **Where removed arms live.** They need a tray in the box; arms are the one loose part in the system.',
          f'- **How many arms a kit needs.** Fewer than three per three-slot piece, since unused ones come off. The most hinged arms any one of the game\'s trees uses is {max(u for _, u, _ in cnt)}, so a kit that can build any of them needs at least that many arms.',
          '- **The snap itself.** The numbers are predictions; the three arms in the set are for finding the right feel on a real printer.']
    if fails:
        L += ['', '## CHECK FAILURES', *[f'- {x}' for x in fails]]
    open(os.path.join(HERE, 'STOW.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
