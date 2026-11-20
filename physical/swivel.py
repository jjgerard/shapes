#!/usr/bin/env python3
"""
The swivel tip cartridge: the thing at the end of the arm that keeps a child plumb.

One arm assembly is
    arm_tip      the arm bar (quick-release tongue at the hinge end) joined through a
                 taper to a TIP HOUSING at the other end (one printed piece)
    swivel hub   a round hub with five detent grooves on each end face, a stem that
                 widens beyond the housing, and the kit's real keyed plug
    two lids     the same flexure lids as the hinge, screwed to the tip housing

The tip housing is the hinge cartridge again (same bore, slot, rings, lids and
detent), turned so its arm-side faces back along the arm. The swivel hub turns
+-50 degrees against it and clicks at 0, +-25 and +-50: set the arm to a click,
twist the child to the opposite click, and the stem points straight down.

This script builds the parts and checks the real meshes: the swivel hub turns
freely, its detent seats at every click, and, in the whole assembly, for every
arm click the child (a block standing in for it) hangs plumb and touches nothing.
It then lays the game's trees out again with the cartridge's real dimensions.

Run from the repo root:  python3 physical/swivel.py
"""
import json, math, os, sys
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon, box as tbox
from trimesh.boolean import union, difference
from shapely.geometry import Polygon, LineString, box as sbox
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import stow as S
import fortify as FO
import coupon as C
import spokes as sp

OUT = os.path.join(HERE, 'hinge', 'swivel')
os.makedirs(OUT, exist_ok=True)
ENGINE = 'manifold'
CHILD_W, CHILD_H, CHILD_D = 30.0, 26.0, 24.0         # a block standing in for the child's body


def arm_tip(t_p=1.3):
    """The arm with a quick-release tongue at the hinge end and the tip housing at the other, in one piece.
    Frame: the hinge axis is the origin and the arm runs along -y."""
    z0, z1 = S.Z0, S.Z1
    W, L = H.ARM_W, H.ARM_LEN
    y_face = -L + H.Y_MAX                                  # the tip housing's back face
    y_ts = y_face + 17.0                                   # where the taper to the housing starts
    shoulder = H.slab(-W / 2, W / 2, y_ts, -4.0, z0, z1)
    shoulder = difference([shoulder, H.cyl(H.R_H + 0.05, z0 - 1, z1 + 1)], engine=ENGINE)
    taper = H.fix(extrude_polygon(Polygon([(-W / 2, y_ts), (-H.X_HALF, y_face), (H.X_HALF, y_face), (W / 2, y_ts)]), z1 - z0, engine='earcut'))
    taper.apply_translation([0, 0, z0])
    tongue = H.slab(-W / 2, W / 2, -H.R_H - 1.0, S.TIP, z0, z1)
    sw = W / 2 - t_p
    slit_poly = LineString([(0, S.Y_ROOT + sw), (0, S.TIP + 1.0)]).buffer(sw, 24)
    slit = H.fix(extrude_polygon(slit_poly, (z1 - z0) + 2, engine='earcut')); slit.apply_translation([0, 0, z0 - 1])
    tongue = difference([tongue, slit], engine=ENGINE)
    housing = H.housing(slot_top=z1 + 0.4, slot_bot=z0 - 0.4)
    housing.apply_translation([0, -L, 0])
    return H.fix(union([shoulder, taper, tongue, S.barb(1), S.barb(-1), housing], engine=ENGINE))


def at(m, x=0.0, y=0.0, z=0.0):
    m = m.copy(); m.apply_translation([x, y, z]); return m


def rotated(m, deg):
    return H.turned(m, deg)


def child_block():
    """The child, as a box with the socket the plug goes into: its top face is the plane where the stem ends."""
    b = tbox(extents=[CHILD_W, CHILD_H, CHILD_D])
    b.apply_translation([0, -(FO.F['STEM_END'] + CHILD_H / 2), H.L_H / 2])
    cav = trimesh.creation.cylinder(radius=11.9, height=C.PLUG_LEN + 0.6, sections=64)
    cav.apply_transform(H.rot_x(90))                       # its axis becomes y
    cav.apply_translation([0, -(FO.F['STEM_END'] + (C.PLUG_LEN + 0.6) / 2 - 0.3), H.L_H / 2])
    return H.fix(difference([b, cav], engine=ENGINE))


def mid_section(m, z):
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union as uu
    segs = trimesh.intersections.mesh_plane(m, [0, 0, 1], [0, 0, z])
    r = lambda v: round(float(v), 5)
    lines = [LineString([(r(p[0][0]), r(p[0][1])), (r(p[1][0]), r(p[1][1]))]) for p in segs]
    return uu(list(polygonize(uu(lines))))


def kinematics_figure(parts, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MPoly
    fig, axes = plt.subplots(1, 5, figsize=(21, 7.4), facecolor='white')
    zmid = H.L_H / 2
    cols = dict(hinge_housing='#b9c0cc', hub='#2f5db8', arm='#e67e22', swivel='#2a9d6f', child='#e2657c')
    secs = {k: mid_section(m, zmid) for k, m in parts['static'].items()}
    for ax, a in zip(axes, H.CLICKS):
        P = (80 * math.sin(math.radians(a)), -80 * math.cos(math.radians(a)))
        for key, geom in (('hinge_housing', secs['hinge_housing']),):
            for poly in (geom.geoms if hasattr(geom, 'geoms') else [geom]):
                if poly.is_empty: continue
                ax.add_patch(MPoly(list(poly.exterior.coords), closed=True, facecolor=cols[key], edgecolor='#223', lw=0.6))
                for hole in poly.interiors:
                    ax.add_patch(MPoly(list(hole.coords), closed=True, facecolor='white', edgecolor='#223', lw=0.6))
        from shapely.affinity import rotate as srot, translate as str_
        for key, geom, rot, shift in (('hub', secs['hub'], a, (0, 0)), ('arm', secs['arm_tip'], a, (0, 0)), ('swivel', secs['swivel'], 0, P), ('child', secs['child'], 0, P)):
            for poly in (geom.geoms if hasattr(geom, 'geoms') else [geom]):
                if poly.is_empty: continue
                p = srot(poly, rot, origin=(0, 0)) if rot else poly
                p = str_(p, shift[0], shift[1])
                ax.add_patch(MPoly(list(p.exterior.coords), closed=True, facecolor=cols[key], edgecolor='#223', lw=0.6, alpha=0.95))
                for hole in p.interiors:
                    ax.add_patch(MPoly(list(hole.coords), closed=True, facecolor='white', edgecolor='#223', lw=0.6))
        ax.set_xlim(-100, 100); ax.set_ylim(-150, 25); ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f'arm {a:+d}°, swivel {-a:+d}°', fontsize=12)
    fig.suptitle('The same child hangs plumb at every arm click: the arm swings, the swivel turns the other way (cut at mid-height)', fontsize=13)
    fig.tight_layout(); fig.savefig(path, dpi=100)


def main():
    cats, modes, types, keys, accepts, cfg, asg = sp.design()
    geo = sp.Spokes(cfg)
    code = asg[frozenset({'D1'})]
    results = {}
    with FO.Patched():
        print('== building the cartridge parts')
        hub = S.hub_q()                                           # the hinge's hub (arm snaps into it)
        hsg = H.housing(slot_top=S.Z1 + 0.4, slot_bot=S.Z0 - 0.4)  # the hinge housing
        tip = arm_tip(1.3)
        swivel = FO.swivel_hub_f(geo, code)
        t = H.T_DESIGN
        lid = FO.lid_f(t)
        plate = H.lid_installed(t, with_nose=False)
        meshes = {'arm_tip': tip, 'swivel_hub': swivel}
        for tv in H.T_VARIANTS:
            meshes[f'lid_t{int(round(tv * 10)):02d}'] = FO.lid_f(tv)
        health = {n: H.health(m) for n, m in meshes.items()}
        for n, m in meshes.items():
            m.export(os.path.join(OUT, f'swivel_{n}.stl')); print(f'   {n}: {health[n]}')

        # ---- the tip housing alone, in its own frame (swivel axis at the origin)
        tip_local = at(tip, 0, H.ARM_LEN, 0)
        plate_b = H.mirrored_bottom(plate)
        nose_top = H.nose_wedge(H.Z_HI, -1)
        nose_bot = nose_top.copy(); nose_bot.apply_transform(H.rot_y(180)); nose_bot.apply_translation([0, 0, H.L_H])

        free = {}
        for b in range(-60, 61, 5):
            s = H.turned(swivel, b)
            free[b] = H.overlap(s, tip_local) + H.overlap(s, plate) + H.overlap(s, plate_b)
        results['free_turn'] = free

        detent = {}
        for b in list(H.CLICKS) + [-37.5, -12.5, 12.5, 37.5]:
            s = H.turned(swivel, b)
            detent[b] = H.overlap(s, nose_top) + H.overlap(s, nose_bot)
        results['detent'] = detent

        # ---- the whole assembly: for each arm click, the swivel counter-turns and the child hangs plumb
        world = {}
        Rz = lambda d: trimesh.transformations.rotation_matrix(math.radians(d), [0, 0, 1])
        local_tip = np.array([0.0, swivel.bounds[0][1], H.L_H / 2, 1.0])        # the plug's tip, in the swivel's own frame

        def pose(a, beta):
            """The swivel hub in the world: turned beta against the tip housing, which is turned a by the arm."""
            M = Rz(a) @ Rz(beta)
            P = (80 * math.sin(math.radians(a)), -80 * math.cos(math.radians(a)), 0.0)
            sw = swivel.copy(); sw.apply_transform(M); sw.apply_translation(P)
            d = (M @ local_tip)[:2]
            return sw, P, math.degrees(math.atan2(d[0], -d[1]))

        for a in H.CLICKS:
            sw_w, P, tilt = pose(a, -a)                  # the swivel counter-turned
            tip_w = rotated(tip, a)
            lids_w = [rotated(at(plate, 0, -H.ARM_LEN, 0), a), rotated(at(plate_b, 0, -H.ARM_LEN, 0), a)]
            ch_w = at(child_block(), *P)
            hits = {}
            hits['swivel vs tip housing + lids'] = H.overlap(sw_w, tip_w) + sum(H.overlap(sw_w, l) for l in lids_w)
            hits['child vs tip housing + lids'] = H.overlap(ch_w, tip_w) + sum(H.overlap(ch_w, l) for l in lids_w)
            hits['child + swivel vs hinge housing'] = H.overlap(ch_w, hsg) + H.overlap(sw_w, hsg)
            hits['child vs the swivel itself'] = H.overlap(ch_w, sw_w)
            hits['arm vs hinge housing'] = H.overlap(tip_w, hsg)
            world[a] = dict(hits=hits, tilt=tilt, relative_is_a_click=(-a in H.CLICKS))
        results['world'] = world
        _, _, mismatch_tilt = pose(50, 0)                  # a mismatched setting, for contrast: arm at +50, swivel left at 0

        # ---- mass
        vol = {n: float(m.volume) for n, m in meshes.items()}
        dens, fill = 1.27e-3, 0.5                       # g/mm3 for PETG, effective fill (walls plus infill)
        mass = dict(tip=vol['arm_tip'] * dens * fill, swivel=vol['swivel_hub'] * dens * fill,
                    lids=2 * vol[f'lid_t{int(round(t * 10)):02d}'] * dens * fill)
        parts = dict(static=dict(hinge_housing=hsg, hub=hub, arm_tip=tip, swivel=swivel, child=child_block()))
        kinematics_figure(parts, os.path.join(OUT, 'kinematics.png'))
        dims = dict(housing=(H.X_HALF * 2, H.Y_MAX - H.Y_MIN, H.Z_HI - H.Z_LO), stem=FO.F['STEM_END'], back=H.Y_MAX, forward=-H.Y_MIN, half=H.X_HALF)

    # ---- check results
    fails = []
    bad = [n for n, h in health.items() if not (h['watertight'] and h['volume'])]
    if bad: fails.append(f'bad meshes {bad}')
    inside = max(v for b, v in results['free_turn'].items() if abs(b) <= 50)
    print(f'== swivel hub turning against the tip housing: overlap within +-50: {inside:.3f} mm3; at +-60: {results["free_turn"][60]:.2f}')
    if inside > 0.01: fails.append('the swivel hub touches the tip housing within its range')
    if results['free_turn'][60] < 0.01: fails.append('the range check is not sensitive at 60 degrees')
    det = results['detent']
    seated = max(det[b] for b in H.CLICKS)
    lands = min(det[b] for b in (-37.5, -12.5, 12.5, 37.5))
    print(f'   detent: seated at the clicks {seated:.3f} mm3 (want ~0), between clicks at least {lands:.2f} mm3 (want > 0)')
    if seated > 0.05: fails.append('the swivel detent does not seat')
    if lands < 0.05: fails.append('the swivel detent does not engage between clicks')
    print('== whole assembly, for each arm click (swivel counter-turned):')
    for a, w in results['world'].items():
        worst = max(w['hits'].values())
        print(f'   arm {a:+d}: stem direction {w["tilt"]:+.1f} deg from plumb, worst overlap {worst:.3f} mm3')
        if worst > 0.01: fails.append(f'arm {a:+d}: parts touch: {[k for k, v in w["hits"].items() if v > 0.01]}')
        if abs(w['tilt']) > 1.0: fails.append(f'arm {a:+d}: the child is not plumb ({w["tilt"]:.1f} deg)')
    print(f'   mismatched (arm +50, swivel not turned): child tilts {mismatch_tilt:+.0f} degrees')
    print('   mass, PETG at about half fill: arm with tip housing {tip:.0f} g, swivel hub {swivel:.0f} g, two lids {lids:.0f} g -> {tot:.0f} g per arm tip'.format(**mass, tot=sum(mass.values())))

    # ---- the trees again, with the cartridge's real dimensions
    print('== laying the trees out with the built cartridge')
    old = (A.TIP_BACK, A.TIP_FWD, A.TIP_HALF, A.TIP_DROP)
    A.TIP_BACK, A.TIP_FWD, A.TIP_HALF, A.TIP_DROP = dims['back'], dims['forward'], dims['half'], dims['stem']
    uniq = []
    seen = set()
    for n, tr in A.load_trees():
        if repr(tr) in seen: continue
        seen.add(repr(tr)); uniq.append((n, tr))
    layouts = {}
    for label, length in (('80 mm arm', 80.0), ('96 mm arm', 96.0)):
        S_ = A.settings([length], list(H.CLICKS))
        D = {1: A.STUB, 2: S_, 3: S_}
        base, _ = A.evaluate(uniq, D, 40.0)
        tipd, _ = A.evaluate(uniq, D, 40.0, tip=True)
        rows = []
        for (n, ok0, p0), (_, ok1, p1) in zip(base, tipd):
            b0 = unary_union([g for k, g, i in p0]).bounds
            if ok1:
                b1 = unary_union([g for k, g, i in p1 if k != 'arm']).bounds
                rows.append((n, (b0[2] - b0[0], b0[3] - b0[1]), (b1[2] - b1[0], b1[3] - b1[1]), A.verify_parts(p1)))
            else:
                rows.append((n, (b0[2] - b0[0], b0[3] - b0[1]), None, []))
        layouts[label] = rows
        nb = sum(1 for r in rows if r[2] is not None)
        probs = sum(len(r[3]) for r in rows)
        print(f'   {label}: {nb} of {len(rows)} trees build with swivel cartridges ({probs} problems on the independent check)')
        for n, b, t_, pr in rows:
            f = lambda v: 'cannot build' if v is None else f'{v[0]:.0f} x {v[1]:.0f}'
            print(f'      {n:<46} without {f(b):>11} | with {f(t_):>12}')
    A.TIP_BACK, A.TIP_FWD, A.TIP_HALF, A.TIP_DROP = old

    write_doc(health, results, mass, dims, layouts, mismatch_tilt, fails)
    json.dump(dict(health=health, free_turn=results['free_turn'], detent=results['detent'], mass=mass, dims=dims,
                   world={a: dict(tilt=w['tilt'], hits=w['hits']) for a, w in results['world'].items()},
                   layouts={k: [(n, b, t_) for n, b, t_, pr in v] for k, v in layouts.items()}),
              open(os.path.join(OUT, 'swivel.json'), 'w'), indent=1, default=float)
    if fails:
        print('FAILED:', *fails, sep='\n  '); sys.exit(1)
    print('all swivel checks passed')


def write_doc(health, results, mass, dims, layouts, mismatch_tilt, fails):
    f = lambda v: '**cannot be built**' if v is None else f'{v[0]:.0f} × {v[1]:.0f}'
    tot = sum(mass.values())
    L = ['# The swivel tip cartridge\n',
         'Generated by `physical/swivel.py`. Parts: `physical/hinge/swivel/`. Figure: `physical/hinge/swivel/kinematics.png`.\n',
         'The cartridge sits on the end of each hinged arm and keeps the child it carries plumb, so that the layouts in `ARMS.md` (which assume upright children) are true. '
         'It is the hinge cartridge again, turned round, with the fortified dimensions from `FORTIFY.md`.\n',
         '## The parts\n',
         '| Part | What it is |', '|---|---|',
         f'| `swivel_arm_tip.stl` | the arm bar with a snap-in tongue at the hinge end, a taper, and the **tip housing** at the other end, all one print. The housing is {dims["housing"][0]:.0f} × {dims["housing"][1]:.0f} × {dims["housing"][2]:.0f} mm |',
         '| `swivel_swivel_hub.stl` | the **swivel hub**: a Ø12 × 24 mm hub with five detent grooves on each end, a 12 mm deep stem that widens beyond the housing, and the kit\'s real keyed plug (the key for a DP here). **The plug is the key-specific part: each slot type needs its own hub**, so a kit has as many hubs as it has keys (26) |',
         '| `swivel_lid_t21/t26/t31.stl` | the flexure lids, three thicknesses to find the right hold; **two of the same thickness per cartridge**, printed plate down |',
         f'| screws | four M3 per lid, eight per cartridge (twelve per arm with the hinge) |', '',
         f'Printed in PETG at about half fill, a cartridge weighs roughly **{tot:.0f} g** (arm with housing {mass["tip"]:.0f}, hub {mass["swivel"]:.0f}, lids {mass["lids"]:.0f}). '
         'The loads in `HINGE.md` assumed about 2 g for an arm; **with the real masses the loads are about three times higher (see "The weight problem" below).**\n',
         '## How it works\n',
         'The housing is rigid with the arm and the hub turns in it, clicking at the same five angles as the hinge (0°, ±25°, ±50°). '
         'The arm\'s own click is α; turn the swivel to −α and the two cancel, so the stem points straight down. In practice: set the arm, then twist the child until it clicks upright. '
         f'If you do not, the child tilts with the arm (mismatched at +50°, the stem tilts {mismatch_tilt:+.0f}°).\n',
         '![kinematics](kinematics.png)\n',
         '## What the script checked on the real meshes\n',
         f'- All {len(health)} parts are watertight solids.',
         f'- **The swivel hub turns freely through ±50° in the tip housing** (overlap {max(v for b, v in results["free_turn"].items() if abs(b) <= 50):.3f} mm³; it does touch at ±60°, so the check can see a collision).',
         f'- **The detent seats at every click** (overlap {max(results["detent"][b] for b in H.CLICKS):.3f} mm³) and engages between them (at least {min(results["detent"][b] for b in (-37.5, -12.5, 12.5, 37.5)):.2f} mm³), like the hinge.',
         '- **In the whole assembly, at each of the five arm clicks with the swivel counter-turned, the child (a 30 × 26 × 24 mm block under the stem) hangs plumb and touches nothing**: not the tip housing, its lids, the swivel, or the hinge housing:\n',
         '| Arm click | stem direction from plumb | worst overlap |', '|---|---|---|']
    for a, w in results['world'].items():
        L.append(f'| {a:+d}° (swivel {-a:+d}°) | {w["tilt"]:+.1f}° | {max(w["hits"].values()):.3f} mm³ |')
    L += ['', '## The trees again, with the real cartridge\n',
          f'Earlier layouts used estimated dimensions (21 mm behind the swivel axis). The built housing is {dims["housing"][0]:.0f} mm wide and extends {dims["back"]:.0f} mm behind the axis and {dims["forward"]:.1f} mm ahead of it, '
          f'and the stem is {dims["stem"]:.0f} mm, so the layout was re-run with those. Sizes in mm:\n']
    for label, rows in layouts.items():
        nb = sum(1 for r in rows if r[2] is not None)
        L += [f'**{label}: {nb} of {len(rows)} trees build** (independent distance check: {sum(len(r[3]) for r in rows)} problems)\n',
              '| Tree | no swivel | with swivel cartridges |', '|---|---|---|']
        for n, b, t_, pr in rows:
            L.append(f'| {n.replace("prex:", "XP · ").replace("xbar:", "X′ · ")} | {f(b)} | {f(t_)} |')
        L.append('')
    L += ['<!-- loads -->', '(run `python3 physical/swivel_loads.py` to fill in the weight analysis)', '<!-- /loads -->', '']
    L += ['## What this does not settle\n',
          '- **The biggest X′ tree** does not build with the cartridge at either arm length, and every other tree gets 18 to 28% taller. The cartridge is large (it is a screwed hinge, with ears for the screws); a compact snap-lid version would be smaller but is not designed.',
          '- **Assembly.** Eight screws per cartridge, sixteen with the hinge, per arm. A kit of 28 arms is hundreds of screws. The sliding arm (`ARM_OPTIONS.md`) has none of this.',
          '- **Keys.** The plug is part of the swivel hub, so changing which slot an arm serves means swapping the hub (a lid has to come off). A key module that snaps onto a common stem would make arms universal; not designed.',
          '- **Strength.** The stem, housing and flexures use the fortified dimensions (`FORTIFY.md`); the joint where the arm bar meets the tip housing is a taper over 17 mm and has not been analysed separately.',
          '- **Print resolution and the detent.** As for the hinge: the groove and wedge are 2 to 3 line widths on a 0.4 mm nozzle.',
          '- **Nothing here has been printed.** The numbers are geometry and calculation.']
    if fails:
        L += ['', '## CHECK FAILURES', *[f'- {x}' for x in fails]]
    open(os.path.join(HERE, 'SWIVEL.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
