#!/usr/bin/env python3
"""
Slide test coupon: the sliding arm's A, S1 and S2 at a third of the length, in three clearance sets,
plus a body block with the arm-mount groove. Print these first: they settle the clearance, the
detent feel and the friction that every number in SLIDE.md assumes.

Each set is A + S1 + S2 (S2 has no foot); stage travel is 12 mm instead of 36, everything else is
the real cross-section. Sets: tight (0.15 mm per side), nominal (0.25), loose (0.35). One A serves all three; a set's fit shows in S1 on A and S2 on S1.

Run from the repo root:  python3 physical/slide_coupon.py
"""
import json, math, os, sys
import numpy as np
import trimesh
from trimesh.boolean import difference

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import slide as S
import hinge as H

OUT = os.path.join(HERE, 'slide_coupon')
os.makedirs(OUT, exist_ok=True)
LEN_C, STEP_C = 32.0, 12.0
CLEARANCES = [('tight', 0.15), ('nominal', 0.25), ('loose', 0.35)]


class Short:
    """Patch slide.py's module constants for a short coupon."""
    def __init__(self, clr):
        self.clr = clr
    def __enter__(self):
        self.old = {k: getattr(S, k) for k in ('LEN', 'STEP', 'TONG_LEN', 'GROOVE_END', 'CLR')}
        S.LEN, S.STEP, S.TONG_LEN, S.GROOVE_END, S.CLR = LEN_C, STEP_C, LEN_C - 3.0, LEN_C - 2.3, self.clr
    def __exit__(self, *a):
        for k, v in self.old.items(): setattr(S, k, v)


def mount_block(clr):
    """A body stand-in: 36 x 14 x 24 with the arm-mount groove (closed at the inner end, open at the outer) and the latch dimple."""
    b = H.slab(0.0, LEN_C + 4.0, -14.0, 0.0, -12.0, 12.0)
    hm = S.NECK / 2 + S.VGAP + clr
    g = S.prism_yz([(0.5, -hm), (0.5, hm), (0.0, hm), (-S.GD, hm + S.GD), (-S.GD, -(hm + S.GD)), (0.0, -hm)], -0.3, LEN_C + 5.0)
    d = S.dimple(S.BUMP_X, 0.0, -1, -S.BEAM_Z1, -S.BEAM_Z0, False)
    return H.fix(difference([b, g, d], engine=S.ENGINE))


def main():
    sets = {}
    report = {}
    for name, clr in CLEARANCES:
        with Short(clr):
            A, S1, S2 = S.part_A(), S.part_S1(), S.part_S2()
            blk = mount_block(clr)
            for p in (A, S1, S2, blk): assert p.is_watertight
            # fit checks on the real meshes: seated stops free, between the stops pressing
            def pose(s1, s2):
                a, b, c = A.copy(), S1.copy(), S2.copy()
                b.apply_translation([s1, 0, 0]); c.apply_translation([s1 + s2, 0, 0]); return a, b, c
            res = {}
            for lab, (s1, s2) in {'in': (0, 0), 'out1': (STEP_C, 0), 'out2': (0, STEP_C), 'out': (STEP_C, STEP_C)}.items():
                a, b, c = pose(s1, s2)
                res[lab] = (S.overlap(a, b), S.overlap(b, c))
            a, b, c = pose(STEP_C / 2, 0); between1 = S.overlap(a, b)
            a, b, c = pose(0, STEP_C / 2); between2 = S.overlap(b, c)
            mount_seated = S.overlap(A, blk)
            Am = A.copy(); Am.apply_translation([5.0, 0, 0]); mount_between = S.overlap(Am, blk)
            ok = all(v == 0.0 for r in res.values() for v in r) and between1 > 0 and between2 > 0 and mount_seated == 0 and mount_between > 0
            report[name] = dict(clearance=clr, seated=res, between=[between1, between2], mount=[mount_seated, mount_between], ok=bool(ok))
            print(f'{name:<8} clr {clr:.2f}: seated overlaps {max(v for r in res.values() for v in r):.3f} mm3, between the stops {between1:.2f}/{between2:.2f}, mount {mount_seated:.3f}/{mount_between:.2f}  {"OK" if ok else "FAILED"}')
            assert ok, name
            sets[name] = (A, S1, S2, blk)
    # the A is the same part in every set apart from the groove it carries for S1; export one A per set
    sets['nominal'][0].export(os.path.join(OUT, 'coupon_A.stl'))     # A does not depend on the clearance: one is enough
    for name, (A, S1, S2, blk) in sets.items():
        S1.export(os.path.join(OUT, f'coupon_S1_{name}.stl'))
        S2.export(os.path.join(OUT, f'coupon_S2_{name}.stl'))
        blk.export(os.path.join(OUT, f'coupon_mount_{name}.stl'))
    json.dump(report, open(os.path.join(OUT, 'coupon.json'), 'w'), indent=1, default=float)
    # preview: the nominal set apart, rendered with the repo's z-buffer renderer
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    import coupon as C
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), facecolor='white')
    A, S1, S2, blk = sets['nominal']
    ms = []
    for m, dy in zip((A, S1, S2), (0, 22, 44)):
        mm = m.copy(); mm.apply_translation([0, dy, 0]); ms.append(mm)
    axes[0].imshow(C.render(trimesh.util.concatenate(ms), w=640, h=460, elev=30, azim=-62)); axes[0].axis('off'); axes[0].set_title('A, S1, S2 (nominal set)', loc='left')
    bv = blk.copy(); bv.apply_transform(H.rot_x(90))                  # groove face up
    axes[1].imshow(C.render(bv, w=640, h=460, elev=40, azim=-62)); axes[1].axis('off'); axes[1].set_title('mount block, groove face up', loc='left')
    fig.tight_layout(); fig.savefig(os.path.join(OUT, 'preview.png'), dpi=120); plt.close(fig)
    write_doc(report)


def write_doc(report):
    s = f"""# Slide test coupon

Generated by `physical/slide_coupon.py`. Files: `physical/slide_coupon/` (10 STLs, `preview.png`, `coupon.json`).

The sliding arm (`SLIDE.md`) rests on four numbers I could only assume: how much clearance the dovetail needs, how hard the detent clicks, what the friction between printed PETG parts is, and whether the arm mount latch holds. This coupon is the sliding arm at a third of the length (each stage travels {STEP_C:.0f} mm, not 36), with the real cross-section and detent, so those four can be measured before anything else is built.

## What to print

**One `coupon_A.stl`** (the fixed bar; it does not depend on the clearance), then three sets, one per clearance: **tight** (0.15 mm per side), **nominal** (0.25, the design value) and **loose** (0.35). Each set is three parts:

| File | What it is |
|---|---|
| `coupon_A.stl` (once) | the fixed bar, 32 mm |
| `coupon_S1_<set>.stl` | the middle slider |
| `coupon_S2_<set>.stl` | the outer slider (no foot) |
| `coupon_mount_<set>.stl` | a body stand-in with the arm-mount groove and latch dimple |

**Print each part lying on one of its 14 mm side faces** (the face with the dovetail seen from the end is *not* down), PETG, 0.2 mm layers, 3 perimeters, 40% gyroid, no supports, no brim; slow the first layer. The dovetail flanks become 45° overhangs and the layer lines then run along the detent beam. Do not sand the sliding faces before the first test.

## What to test, and what to write down

1. **Assembly.** Slide S1 onto A from the outer end until the end of the groove stops it, then S2 onto S1. Note for each set: *free* (falls through by itself), *good* (slides with light pressure), *tight* (needs force) or *stuck*.
2. **Detent.** Push each stage in and out by hand. It should click at both ends, hold, and release with a firm push. Note whether the click is too light (the stage drifts), right, or too hard (you have to force it).
3. **Push-out force.** With A clamped horizontal, hang a bag from S2's end and add weight until the stage leaves its stop; the design values are **2.6 / 6.4 / 15 N** (270 / 650 / 1500 g) for friction 0 / 0.3 / 0.45. Whichever of these your result is nearest to tells you the friction.
4. **Mount.** Slide A into the mount block from the open end until it stops, and note the latch click. Pull it back out by hand: the design value is about 6 N.
5. **Beam wear.** Cycle one stage 200 times and look for whitening or a crack at the root of the detent beam (the design's stress there is right at the repeated-flexing limit).

## Reading the results

- If *nominal* is **good**, the design stands. If *tight* is good and *nominal* is loose, change `CLR` in `slide.py` and run again.
- If the click is too light or too hard, the bump height or the beam length in `slide.py` changes; tell me which and by how much.
- If the push-out force is below 2.6 N, the printed surfaces are slicker than assumed and the detent needs to be stronger.

## What the script already checked

For each of the three sets, on the real meshes: all four parts are watertight; at every stop, stage in and out, **no part overlaps another**; half-way between the stops each stage **presses into the face** (the bump rides on it); and the mount block takes A with no overlap when seated and presses on the latch when pulled out. All three sets pass:

| Set | Clearance | Seated overlap | Pressing between stops (mm³) | Mount latch pressing (mm³) |
|---|---|---|---|---|
""" + "\n".join(f"| {n} | {r['clearance']:.2f} | 0.000 | {r['between'][0]:.2f} / {r['between'][1]:.2f} | {r['mount'][1]:.2f} |" for n, r in report.items()) + """

![preview](preview.png)

## Not covered by this coupon

The foot and plug insert, the fixed middle post, the loads at full length, and the strength of the first slider under a pull. Those wait for the first full-length arm.
"""
    open(os.path.join(HERE, 'SLIDE_COUPON.md'), 'w').write(s)


if __name__ == '__main__':
    main()
