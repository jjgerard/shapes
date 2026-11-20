#!/usr/bin/env python3
"""
The cartridges are heavy. Recompute the hinge and swivel loads with the real masses.

HINGE.md assumed piece masses of 8 to 19 g with about 2 g per arm. With the real parts
(a hinge cartridge of about 13 g in every slot of a piece, and about 21 g on the tip of every
used arm) a three-slot piece is about 50 g before any arm, and every hinged arm adds 21 g
at its tip. This script redoes the load calculation of HINGE.md and ARM_OPTIONS.md with those
masses (the geometry is the same upright layout), and says what it does to the design.

Run from the repo root (after swivel.py):  python3 physical/swivel_loads.py
"""
import json, math, os, statistics, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import spokes as sp

OUT = os.path.join(HERE, 'hinge', 'swivel')
DENS, FILL = 1.27e-3, 0.5                      # g/mm3 PETG, effective fill

# volumes from the built parts (mm3): hinge housing, hub, one lid; arm with tip housing, swivel hub
V = json.load(open(os.path.join(OUT, 'swivel.json')))['health']
F = json.load(open(os.path.join(HERE, 'hinge', 'fortified', 'fortify.json')))
def vol(d, k): return d[k]['mm3']
# the fortified hinge housing, hub and lid volumes come from fortify's saved meshes
import trimesh
FORT = os.path.join(HERE, 'hinge', 'fortified')
mesh_vol = lambda f: float(trimesh.load(os.path.join(FORT, f)).volume)
hinge_cart = (mesh_vol('fort_housing.stl') + mesh_vol('fort_hub_q.stl') + 2 * mesh_vol('fort_lid_t26.stl')) * DENS * FILL
tip_asm = (vol(V, 'arm_tip') + vol(V, 'swivel_hub') + 2 * vol(V, 'lid_t26')) * DENS * FILL
BODY = 10.0                                    # a piece's own body, g (assumed)
MASS = {0: 8.0, 1: 9.0, 2: BODY + 2 * hinge_cart, 3: BODY + 3 * hinge_cart}
G = H.G


def loads(res):
    rows = []
    for name, ok, parts in res:
        bodies = {i[1]: (g.centroid, i[0]) for k, g, i in parts if k == 'body'}
        kids = defaultdict(list); arms = {}
        for k, g, i in parts:
            if k == 'arm':
                kids[i[3]].append(i[4]); arms[(i[3], i[4])] = (g, i)
        def sub(u):
            return [u] + [x for c in kids[u] for x in sub(c)]
        for (pu, cu), (g, (st, t, slot, _, _)) in arms.items():
            if st.length < 30: continue                      # stubs do not hinge
            (px, py), (ex, ey) = list(g.coords)
            members = sub(cu)
            Mw = Mh = Mtip = W = 0.0
            pts = []
            for u in members:
                c, ty = bodies[u]
                m = MASS[len(sp.PORTS.get(ty, {}))]
                pts.append((m, c.x, c.y))
                for ch in kids[u]:                           # the tip assembly of every hinged arm below
                    ge, ie = arms[(u, ch)]
                    if ie[0].length > 30: pts.append((tip_asm, list(ge.coords)[1][0], list(ge.coords)[1][1]))
            sub_pts = list(pts)
            pts.append((tip_asm, ex, ey))                    # this arm's own tip assembly hangs at its end
            for m, x, y in pts:
                W += m
                Mw += m * G * math.hypot(x - px, y - py)
                Mh += m * G * abs(x - px)
            # about the tip pivot: only what hangs below it
            net = sum(m * G * (x - ex) for m, x, y in sub_pts)
            rows.append(dict(tree=name, piece=t, grams=W, M_worst=Mw, M_hang=Mh, tip_net=abs(net)))
    return rows


def main():
    seen, uniq = set(), []
    for n, t in A.load_trees():
        if repr(t) in seen: continue
        seen.add(repr(t)); uniq.append((n, t))
    A.ARM_T, A.PIVOT_PITCH, A.HUB = H.ARM_W, H.PITCH, 2 * H.R_SLEEVE
    res, _ = A.evaluate(uniq, A.CHOSEN, 40.0)
    rows = loads(res)
    pc = lambda a, p: sorted(a)[min(len(a) - 1, int(p * len(a)))]
    w = [r['M_worst'] for r in rows]; h = [r['M_hang'] for r in rows]; n = [r['tip_net'] for r in rows]
    old = dict(worst=(20, 139, 460, 1949), hang=(6, 31, 134, 613))
    new = dict(worst=(statistics.median(w), pc(w, .75), pc(w, .9), max(w)), hang=(statistics.median(h), pc(h, .75), pc(h, .9), max(h)),
               tip=(statistics.median(n), pc(n, .75), pc(n, .9), max(n)))
    peak = [H.torque_peak(2.0, mu) for mu in (0.0, 0.3, 0.45)]
    cov = lambda arr, T: 100 * sum(1 for v in arr if v <= T) / len(arr)
    print(f'hinge cartridge {hinge_cart:.1f} g; arm tip assembly {tip_asm:.1f} g; piece masses {{heads 8, one-slot 9, two-slot {MASS[2]:.0f}, three-slot {MASS[3]:.0f}}} g')
    print(f'{len(rows)} hinged arms. hinge torque N*mm (median/75/90/max):')
    print(f'   worst tilt: now {tuple(round(x) for x in new["worst"])}  (was {old["worst"]})')
    print(f'   hanging   : now {tuple(round(x) for x in new["hang"])}  (was {old["hang"]})')
    print(f'   swivel tip, net: {tuple(round(x) for x in new["tip"])}')
    for T in (109, 230, 400):
        print(f'   a detent holding {T} N*mm holds {cov(h, T):.0f}% of arms hanging, {cov(w, T):.0f}% in worst tilt; swivel: {cov(n, T):.0f}%')
    ratio = new['worst'][2] / old['worst'][2]
    json.dump(dict(hinge_cart=hinge_cart, tip_asm=tip_asm, masses=MASS, old=old, new=new, ratio_p90=ratio,
                   coverage={T: dict(hang=cov(h, T), worst=cov(w, T), tip=cov(n, T)) for T in (109, 230, 400)}),
              open(os.path.join(OUT, 'loads.json'), 'w'), indent=1)
    write_section(old, new, peak, cov, h, w, n, ratio)


def write_section(old, new, peak, cov, h, w, n, ratio):
    f = lambda t: ' | '.join(f'{x:.0f}' for x in t)
    fb = lambda t: ' | '.join(f'**{x:.0f}**' for x in t)
    L = ['## The weight problem\n',
         f'The earlier load numbers (`HINGE.md`, `ARM_OPTIONS.md`) assumed a piece weighs 8 to 19 g with about 2 g per arm. The real parts are heavier: a hinge cartridge (housing, hub and lids) is about **{hinge_cart:.0f} g**, '
         f'every slot of a piece has one, and every used arm carries about **{tip_asm:.0f} g** at its tip. A three-slot piece is about {MASS[3]:.0f} g before any arm. '
         'Recomputed with those masses (same trees, same upright layouts; masses are PETG at about half fill, so treat as estimates):\n',
         '| Hinge torque (N·mm) | median | 75% | 90% | largest |', '|---|---|---|---|---|',
         f'| hanging, before | {f(old["hang"])} |', f'| **hanging, now** | {fb(new["hang"])} |',
         f'| worst tilt, before | {f(old["worst"])} |', f'| **worst tilt, now** | {fb(new["worst"])} |',
         f'| swivel tip, net torque, now | {f(new["tip"])} |', '',
         f'The loads are about **{ratio:.1f}×** what they were at the 90th percentile. The hinge detent design (peak torque {peak[0]:.0f} / {peak[1]:.0f} / {peak[2]:.0f} N·mm without / with friction) now holds '
         f'{cov(h, 230):.0f}% of arms hanging as built and {cov(w, 230):.0f}% in a worst-case tilt (at μ 0.3), against 96% and 83% before; the swivel detent holds {cov(n, 230):.0f}% of children upright. '
         f'The "carried" rows in `FORTIFY.md` scale the same way: their safety factors fall by about {ratio:.1f}×, so the arm bar carried out of plane (2.6) is about {2.6 / ratio:.1f} and the stem hanging (2.5) about {2.5 / ratio:.1f}. '
         'The shoved rows do not change (they are set by a hand, not by the structure).\n',
         '**What this means.** The system carries a lot of its own weight, and almost all of it is the cartridges. Either the cartridges get much lighter (a compact snap-lid version with thin walls and less fill), '
         'or the detents get stronger (the 2.4 mm flexure, with a stiffer feel), or the arms are made to take the load, or trees are not lifted whole. This is the strongest argument yet for the sliding arm (`ARM_OPTIONS.md`), '
         'which has no cartridge at all.\n']
    p = os.path.join(HERE, 'SWIVEL.md')
    d = open(p).read()
    a, b = '<!-- loads -->', '<!-- /loads -->'
    block = a + '\n' + '\n'.join(L) + '\n' + b
    if a in d and b in d:
        d = d[:d.index(a)] + block + d[d.index(b) + len(b):]
    else:
        marker = '## What this does not settle'
        d = d.replace(marker, block + '\n' + marker, 1)
    open(p, 'w').write(d)


if __name__ == '__main__':
    main()
