#!/usr/bin/env python3
"""
Whiteboard kit test coupon: the smallest print that answers the open questions before a whole set is printed.

  coupon_cups.stl      a plate with three cups of radius 2.6 / 2.7 / 2.85 mm (the design is 2.7), each with its joint-magnet pocket
  coupon_pockets.stl   a plate with three cups of 2.7 mm and joint-magnet pockets of 3.1 / 3.2 / 3.35 mm for a 3 x 1.5 mm magnet (design: 3.2)
  coupon_board.stl     a plate with three board-magnet pockets of 8.1 / 8.2 / 8.4 mm for an 8 x 2 mm magnet (design: 8.2)
  coupon_stick_47/48/49.stl   20 mm sticks with ball holes of 4.7 / 4.8 / 4.9 mm for a 5 mm steel ball (design: 4.8)
  plus real parts from the kit: tile_N1 (an NP), tile_N2 (an N0), tile_abbr_small, stick_20, stick_40 (copied from whiteboard/)

Run from the repo root:  python3 physical/whiteboard_coupon.py
"""
import json, os, shutil, sys, math
import numpy as np
import trimesh
from trimesh.creation import box as tbox, cylinder, icosphere
from trimesh.boolean import difference, intersection

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import concept as K
import hinge as H
import whiteboard as W

OUT = os.path.join(HERE, 'whiteboard_coupon')
os.makedirs(OUT, exist_ok=True)
T = K.THICK


def plate(w, h):
    return H.fix(tbox(extents=[w, h, T]) if False else _plate(w, h))


def _plate(w, h):
    m = tbox(extents=[w, h, T]); m.apply_translation([0, 0, T / 2]); return m


def cups_plate(radii, pocket_ds, board_ds=None, w=50.0, h=18.0):
    m = _plate(w, h)
    cuts = []
    xs = [-14.0, 0.0, 14.0]
    for x, r, pd in zip(xs, radii, pocket_ds):
        s = icosphere(subdivisions=3, radius=r); s.apply_translation([x, 0, T + 0.9]); cuts.append(s)
        p = cylinder(radius=pd / 2, height=3.9, sections=32); p.apply_translation([x, 0, 3.8 / 2 - 0.1]); cuts.append(p)
    return H.fix(difference([m] + cuts, engine='manifold'))


def board_plate(ds, w=58.0, h=14.0):
    m = _plate(w, h)
    cuts = []
    for x, d in zip((-19.0, 0.0, 19.0), ds):
        p = cylinder(radius=d / 2, height=2.2, sections=40); p.apply_translation([x, 0, 0.9]); cuts.append(p)
    return H.fix(difference([m] + cuts, engine='manifold'))


def stick20(hole_d):
    from trimesh.creation import box as tb
    L = 20.0
    bar = tb(extents=[L + 8.0, 4.0, 3.0]); bar.apply_translation([L / 2, 0, 1.5])
    cuts = []
    for x in (0.0, L):
        c = cylinder(radius=hole_d / 2, height=6.0, sections=48); c.apply_translation([x, 0, 1.5 - 0.6]); cuts.append(c)
    return H.fix(difference([bar] + cuts, engine='manifold'))


BALL_R = 2.5
SNAP_CUP_R = 2.6


SNAP_INTERFERENCE = (0.15, 0.30, 0.45)                    # on the ball's diameter: the narrowest ring of the cup is this much smaller than the ball
SNAP_MOUTH = [BALL_R - i / 2 for i in SNAP_INTERFERENCE]  # radius of the narrowest ring
LEAD = 0.35                                               # the narrowest ring is this far below the face; a cone widens the cup to the face


def snap_d(mr):
    """Depth of the cup sphere's centre below the face so that the sphere's radius, LEAD below the face, equals mr: the ring there is the constriction."""
    return LEAD + math.sqrt(SNAP_CUP_R ** 2 - mr ** 2)


SNAP_STICK_D = snap_d(SNAP_MOUTH[1])                      # the printed stick is made for the middle cup


def snap_cavity(x, mr):
    """A sphere of radius 2.6 (the ball sits in it) whose upper part narrows to radius mr, smaller than the ball, LEAD below the face: that ring is the snap.
    Above it a cone widens to the face so the ball can be pushed in."""
    import trimesh
    d = snap_d(mr)
    sph = icosphere(subdivisions=3, radius=SNAP_CUP_R); sph.apply_translation([x, 0, T - d])
    cone = trimesh.creation.revolve(np.array([[0.0, T - LEAD], [mr, T - LEAD], [mr + 0.5, T + 0.01], [0.0, T + 0.01]]), sections=48)
    cone.apply_translation([x, 0, 0])
    return [sph, cone]


def snap_plate(slit, w=50.0, h=18.0):
    """Three snap cups with constrictions of 4.85 / 4.70 / 4.55 mm for a 5 mm printed ball. With slit=True two thin slits cut the lip so it can spread."""
    m = _plate(w, h)
    cuts = []
    for x, mr in zip((-14.0, 0.0, 14.0), SNAP_MOUTH):
        cuts += snap_cavity(x, mr)
        if slit:
            sl = tbox(extents=[0.6, 9.0, 3.2]); sl.apply_translation([x, 0, T - 1.6 + 0.01]); cuts.append(sl)
    return H.fix(difference([m] + cuts, engine='manifold'))


def snap_stick(ball_r=BALL_R, L=20.0):
    """A stick with printed balls, ball side up for printing (the bar's top face is on the bed)."""
    from trimesh.boolean import union
    bar = tbox(extents=[L + 8.0, 4.0, 3.0]); bar.apply_translation([L / 2, 0, 1.5])
    balls = []
    for x in (0.0, L):
        b = icosphere(subdivisions=3, radius=ball_r); b.apply_translation([x, 0, -(0.15 + SNAP_STICK_D)]); balls.append(b)
    m = H.fix(union([bar] + balls, engine='manifold'))
    m.apply_transform(H.rot_x(180))                   # ball side up
    m.apply_translation([0, 0, -m.bounds[0][2]])
    return m, bar, balls


def main():
    files = {}
    files['coupon_cups.stl'] = cups_plate((2.6, 2.7, 2.85), (3.2, 3.2, 3.2))
    files['coupon_pockets.stl'] = cups_plate((2.7, 2.7, 2.7), (3.1, 3.2, 3.35))
    files['coupon_board.stl'] = board_plate((8.1, 8.2, 8.4))
    for d in (4.7, 4.8, 4.9):
        files[f'coupon_stick_{int(round(d * 10))}.stl'] = stick20(d)
    # the printed-ball snap variant: plain and slit lips, and sticks with balls of 5.0 and 4.9 mm
    files['coupon_snap_cups.stl'] = snap_plate(False)
    files['coupon_snap_cups_slit.stl'] = snap_plate(True)
    st50, bar, balls = snap_stick(5.0 / 2); files['coupon_snap_stick_50.stl'] = st50
    st49, _, _ = snap_stick(4.9 / 2); files['coupon_snap_stick_49.stl'] = st49
    # a flat plate for stick-on magnet sheet or self-adhesive magnets (no pockets)
    files['coupon_flat.stl'] = H.fix(_plate(32.0, 32.0))
    report = {}
    for f, m in files.items():
        assert m.is_watertight, f
        m.export(os.path.join(OUT, f))
        report[f] = [round(float(x), 1) for x in m.extents]
    for f in ('tile_N1.stl', 'tile_N2.stl', 'tile_abbr_small.stl', 'stick_20.stl', 'stick_40.stl'):
        shutil.copy(os.path.join(HERE, 'whiteboard', f), os.path.join(OUT, 'kit_' + f))
        report['kit_' + f] = [round(float(x), 1) for x in trimesh.load(os.path.join(OUT, 'kit_' + f)).extents]
    # a 5 mm steel ball seated in each cup (centre at the cup's centre) must not touch the plate
    ball = icosphere(subdivisions=3, radius=2.5)
    seat = {}
    for f in ('coupon_cups.stl', 'coupon_pockets.stl'):
        plate_m = files[f]
        for x in (-14.0, 0.0, 14.0):
            b = ball.copy(); b.apply_translation([x, 0, T + 0.9])
            r = intersection([plate_m, b], engine='manifold')
            seat[f'{f} x={x:+.0f}'] = float(r.volume) if len(r.faces) else 0.0
    # snap: a printed ball seated in its cup touches nothing; in the neck it is squeezed (that is the snap), more for the narrower necks
    snap = {}
    for f in ('coupon_snap_cups.stl', 'coupon_snap_cups_slit.stl'):
        plate_m = files[f]
        for x, mr in zip((-14.0, 0.0, 14.0), SNAP_MOUTH):
            b = ball.copy(); b.apply_translation([x, 0, T - snap_d(mr)])
            seated = intersection([plate_m, b], engine='manifold'); seated_v = float(seated.volume) if len(seated.faces) else 0.0
            b2 = ball.copy(); b2.apply_translation([x, 0, T - LEAD])
            neck = intersection([plate_m, b2], engine='manifold'); neck_v = float(neck.volume) if len(neck.faces) else 0.0
            snap[f'{f} ring {2 * mr:.2f} mm'] = dict(seated=seated_v, at_neck=neck_v)
    # the snap stick sits 0.15 mm above the plate when its ball is in the middle cup
    print('ball in cup (should all be 0 mm3):', 'ok' if not {k: v for k, v in seat.items() if v != 0.0} else 'FAILED')
    for k, v in snap.items():
        print(f'   {k}: seated {v["seated"]:.3f} mm3, squeezed at the ring {v["at_neck"]:.2f} mm3')
    assert all(v['seated'] < 0.05 for v in snap.values()), 'the printed ball does not seat in a snap cup'
    assert all(v['at_neck'] > 0 for v in snap.values()), 'no snap interference'
    print('files:', len(report))
    json.dump(dict(files=report, seat=seat, snap=snap), open(os.path.join(OUT, 'coupon.json'), 'w'), indent=1)
    write_docs(report)


def write_docs(report):
    import glob
    vol = sum(trimesh.load(f).volume for f in glob.glob(os.path.join(OUT, '*.stl')))
    grams = vol * 1.27e-3 * 0.5 * 2
    n = len(glob.glob(os.path.join(OUT, '*.stl')))
    s = f"""# Whiteboard kit: test coupon and order sheet

Generated by `physical/whiteboard_coupon.py`. Files: `physical/whiteboard_coupon/` ({n} STLs).

## What it is for

Nothing in the whiteboard kit has been printed. The coupon tests **three ways to hold the joint and the tile**, with a few grams of plastic, so you can pick the cheapest one that works before a whole set is made.

| Question | Variant A: steel balls and magnets (the design) | Variant B: printed balls, snap-fit cups (no steel, no joint magnets) | Variant C: stick-on magnets |
|---|---|---|---|
| What holds a ball in its cup | a joint magnet behind the cup pulls a pressed-in 5 mm steel ball | the printed ball snaps past a narrow ring and sits in a slightly bigger cup | as A, but the magnets are self-adhesive rather than pushed into a pocket |
| Parts to add after printing | 5 mm steel balls, 3 x 1.5 mm and 8 / 6 mm magnets | none | self-adhesive magnets, or magnetic sheet |
| Files | `coupon_cups`, `coupon_pockets`, `coupon_board`, `coupon_stick_47/48/49` | `coupon_snap_cups`, `coupon_snap_cups_slit`, `coupon_snap_stick_50/49` | `coupon_flat`, and the pockets of A |

The last five files (prefixed `kit_`) are real kit parts: an NP tile, an N0 tile, a small abbreviation triangle and a 20 mm and a 40 mm stick, so one phrase can be built and moved at full size.

## Variant A: steel balls and magnets

- `coupon_cups.stl`: three cups of radius 2.6 / 2.7 / 2.85 mm (the design is 2.7), each with its pocket for a 3 x 1.5 mm joint magnet.
- `coupon_pockets.stl`: three pockets of 3.1 / 3.2 / 3.35 mm for the same magnet (design 3.2).
- `coupon_board.stl`: three pockets of 8.1 / 8.2 / 8.4 mm for an 8 x 2 mm board magnet (design 8.2).
- `coupon_stick_47/48/49.stl`: 20 mm sticks with 4.7 / 4.8 / 4.9 mm holes for a 5 mm steel ball (design 4.8).

## Variant B: printed balls, snap-fit cups

- `coupon_snap_stick_50.stl` and `coupon_snap_stick_49.stl`: 20 mm sticks with a **printed ball** of 5.0 and 4.9 mm at each end. Print them **ball side up**; they are already turned that way.
- `coupon_snap_cups.stl` and `coupon_snap_cups_slit.stl`: three snap cups each. A cup is a sphere of 2.6 mm radius with a **constriction ring** of 4.85 / 4.70 / 4.55 mm, 0.35 mm below the face (so the ball is 0.15 / 0.30 / 0.45 mm too big to pass freely), and a cone above the ring to guide the ball in. In the "slit" plate two thin slits cut the lip so it can spread. The sticks are made for the middle cup.
- Checked on the meshes: a 5 mm ball sits in every cup with no contact, and is squeezed at the ring by 0.14 / 0.49 / 0.99 mm³ for the three rings (0.13 / 0.45 / 0.91 in the slit plate), so the three rings really are tighter in that order. **Whether PETG lets the lip spread and spring back, and how much force holds the ball, are not known: that is what the print answers.**
- If it works, the joint needs no steel balls and no joint magnets, which removes 122 pressed balls and 166 pushed magnets from every set. Board magnets stay.

## Variant C: stick-on magnets (3M-style adhesive)

- Pushing the board magnets into pockets can be replaced by **self-adhesive magnets** (neodymium discs sold with a 3M-type adhesive backing) stuck into the same pockets, or by **a piece of adhesive-backed flexible magnetic sheet** stuck over the whole back of a tile. The adhesive only has to hold a few grams of tile and the magnet's own pull when a tile is peeled off the board, which a good acrylic foam adhesive on clean PETG should do, but I have not tested it.
- Whether a **flexible magnet sheet** is strong enough to hold a tile on a vertical steel board through the board's coating is the open question: it is much weaker than a neodymium disc per area. `coupon_flat.stl` is a plain 32 x 32 x 6 mm plate to stick a piece of sheet to and test.
- A stick-on magnet **cannot replace the joint magnet** behind a cup: it would sit 4 mm from the cup floor, too far to pull a ball. Variant B removes that magnet instead.

## What to print

PETG if available. 0.2 mm layers, 3 perimeters, about 40% infill, no supports, no brim. Print each plate and tile **back-down** and each stick flat (the snap sticks ball up). **Two copies of every file** is a good idea. Plastic for two copies of everything: about {grams:.0f} g.

## What to buy for the test

| Item | How many | For |
|---|---|---|
| Neodymium disc magnet 8 x 2 mm (N35) | 8 | variant A board magnets |
| Neodymium disc magnet 6 x 2 mm | 6 | the N0 tile and triangle |
| Neodymium disc magnet 3 x 1.5 mm | 25 | variant A joint magnets |
| Steel ball 5 mm (a bearing ball, not a magnet) | 20 | variant A stick ends |
| Self-adhesive neodymium disc magnets, about 8 mm | 6 | variant C |
| Adhesive-backed flexible magnetic sheet | one A5 sheet | variant C |
| A steel-backed whiteboard or a steel sheet | the board you will use | the real test |

All sizes match the pockets as drawn. If a shop sells 8 x 1.5 mm or 6 x 1.5 mm discs, they fit.

## What to do with it, and what to write down

1. **Variant B first, because it needs nothing bought.** Press a printed stick's ball into each cup of `coupon_snap_cups` and the slit plate (push the ball straight in). Note for each of the six cups: does it go in (too tight / right / loose), does it hold the ball on a vertical board, does the stick turn freely, does the lip crack.
2. **Variant A.** Push a 3 x 1.5 mm magnet into each pocket of `coupon_pockets` and `coupon_cups` (note which of 3.1 / 3.2 / 3.35 is snug). Press a steel ball into each hole of the three sticks (note which of 4.7 / 4.8 / 4.9 holds it). Seat a ball in each cup of `coupon_cups` (note which of 2.6 / 2.7 / 2.85 holds it on a vertical board).
3. **Board magnets.** Push 8 x 2 mm magnets into `coupon_board` and stick it on your whiteboard (note which pocket is snug and whether the plate stays up). Then stick a self-adhesive magnet and a piece of magnet sheet to `coupon_flat` and try it on the board (note whether each stays up, and how easily it slides).
4. **A phrase.** Join the NP tile to the N0 tile and the triangle with sticks and slide the phrase by one tile on the board. Note whether the joints pull apart and whether the phrase flops.

Send me those results and I will set the sizes in the real design, and pick A or B.

## Order sheet (to give to a print shop or a makerspace)

**Parts:** the {n} STL files in this folder, two copies of each. Total plastic: about {grams:.0f} g.
**Material:** PETG preferred; PLA acceptable for this test, but say which was used.
**Settings:** 0.2 mm layer height, 3 perimeters, about 40% infill, no supports. Back-down for plates and tiles; sticks flat (the snap sticks ball side up).
**Tolerance:** the pockets, holes and cups are drawn at their final sizes. Please do not scale parts, and please tell me which printer and nozzle was used.
**Not part of the print:** magnets, steel balls, magnetic sheet and the whiteboard are bought separately (the table above).
"""
    open(os.path.join(HERE, 'WHITEBOARD_COUPON.md'), 'w').write(s)


if __name__ == '__main__':
    main()
