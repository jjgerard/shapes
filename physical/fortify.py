#!/usr/bin/env python3
"""
Where the swivel arm would break, and how to fortify it.

Step 1 finds the break points of the CURRENT parts (HINGE.md, STOW.md) by hand
calculation, from the loads in the game's own trees plus a "someone shoves the
arm" abuse case. Step 2 builds a fortified version of the parts, re-checks the
real meshes, and recomputes the safety factors.

What changes (each aimed at a number from step 1):
  * the hub is longer (24 mm, not 12) and the arm deeper (12 mm, not 8), so the
    hub walls beside the socket are about 6 mm thick, not 1 to 2;
  * the housing's arm slot no longer opens to the floor: a full ring above AND
    below the arm holds the hub in and carries the arm's sideways load;
  * the slit in the arm's tongue ends in a full round, not a square corner;
  * the swivel stem is deeper and widens beyond the hub, with a fillet;
  * the flexure beams are longer (same stiffness, thicker, lower stress) and the
    slots round off where the beam joins the lid.
Material and print advice (carbon-fibre nylon, perimeters, orientation) is in
the document; the numbers show it both for PETG and for carbon-fibre nylon.

Run from the repo root:  python3 physical/fortify.py
"""
import json, math, os, sys
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon
from trimesh.boolean import union, difference
from shapely.geometry import Polygon, LineString, box as sbox
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hinge as H
import stow as S
import coupon as C
import spokes as sp

OUT = os.path.join(HERE, 'hinge', 'fortified')
os.makedirs(OUT, exist_ok=True)
ENGINE = 'manifold'

# material allowables, MPa, for repeated loading (assumptions; see the document)
MATERIALS = {'PETG': dict(sig=20.0, endurance=12.0), 'carbon-fibre nylon': dict(sig=40.0, endurance=22.0)}

# the fortified dimensions (mm)
F = dict(L_H=24.0, T_ARM=12.0, BEAM_Y_ANCHOR=21.0, Y_MAX=25.0, T_SCALE=1.3, STEM_END=28.0, STEM_W_FAR=10.0, BOSS_W=10.0)
OLD = dict(L_H=12.0, T_ARM=8.0, BEAM_L=H.BEAM_L)


class Patched:
    """Temporarily change module constants that the part builders read."""
    def __enter__(self):
        self.saved = {}
        def put(mod, name, val):
            self.saved[(mod, name)] = getattr(mod, name); setattr(mod, name, val)
        L = F['L_H']
        put(H, 'L_H', L); put(H, 'Z_HI', L + H.GAP)
        put(S, 'Z0', (L - F['T_ARM']) / 2); put(S, 'Z1', (L + F['T_ARM']) / 2)
        put(H, 'BEAM_Y_ANCHOR', F['BEAM_Y_ANCHOR']); put(H, 'Y_MAX', F['Y_MAX'])
        put(H, 'BEAM_L', F['BEAM_Y_ANCHOR'] - H.BEAM_Y_NOSE)
        put(H, 'SCREWS', [(sx * 10.0, y) for sx in (-1, 1) for y in (4.0, F['Y_MAX'] - 3.0)])
        put(H, 'T_VARIANTS', [round(t * F['T_SCALE'], 1) for t in (1.6, 2.0, 2.4)])
        put(H, 'T_DESIGN', round(2.0 * F['T_SCALE'], 1))
        return self
    def __exit__(self, *a):
        for (mod, name), v in self.saved.items(): setattr(mod, name, v)


# ---------------------------------------------------------------- the fortified parts
def arm_f(t_p=1.3):
    """The arm with a round slit end, and a flared boss round the test hole."""
    z0, z1 = S.Z0, S.Z1
    W = H.ARM_W
    shoulder = H.slab(-W / 2, W / 2, -H.ARM_LEN, -4.0, z0, z1)
    boss = H.fix(extrude_polygon(Polygon([(-W / 2, -58), (-F['BOSS_W'] / 2, -68), (-F['BOSS_W'] / 2, -H.ARM_LEN), (F['BOSS_W'] / 2, -H.ARM_LEN),
                                          (F['BOSS_W'] / 2, -68), (W / 2, -58)]), z1 - z0, engine='earcut'))
    boss.apply_translation([0, 0, z0])
    shoulder = union([shoulder, boss], engine=ENGINE)
    shoulder = difference([shoulder, H.cyl(H.R_H + 0.05, z0 - 1, z1 + 1)], engine=ENGINE)
    tongue = H.slab(-W / 2, W / 2, -H.R_H - 1.0, S.TIP, z0, z1)
    sw = W / 2 - t_p
    slit_poly = LineString([(0, S.Y_ROOT + sw), (0, S.TIP + 1.0)]).buffer(sw, 24)         # full round at the root end
    slit = H.fix(extrude_polygon(slit_poly, (z1 - z0) + 2, engine='earcut')); slit.apply_translation([0, 0, z0 - 1])
    tongue = difference([tongue, slit], engine=ENGINE)
    arm = union([shoulder, tongue, S.barb(1), S.barb(-1)], engine=ENGINE)
    return H.fix(difference([arm, H.cyl(2.0, z0 - 1, z1 + 1, 0.0, S.HOLE_Y, 48)], engine=ENGINE))


def lid_f(t):
    """The lid with rounded slot ends (a sharp slot end where the beam joins the lid is a stress raiser)."""
    z0 = H.Z_HI
    plate = H.slab(-H.X_HALF, H.X_HALF, H.Y_MIN, H.Y_MAX, z0, z0 + t)
    yb0 = H.R_M - 2.9
    bw, sw = H.BEAM_W, H.SLOT_W
    u = sbox(-bw / 2 - sw, yb0 - sw, bw / 2 + sw, H.BEAM_Y_ANCHOR).difference(sbox(-bw / 2, yb0, bw / 2, H.BEAM_Y_ANCHOR + 5))
    u = u.buffer(-0.15).buffer(0.15 + 0.25)        # round the ends and corners of the cut
    slot = H.fix(extrude_polygon(u, t + 2, engine='earcut')); slot.apply_translation([0, 0, z0 - 1])
    cuts = [slot] + [H.cyl(1.7, z0 - 1, z0 + t + 1, x, y, 24) for x, y in H.SCREWS]
    pl = H.fix(difference([plate] + cuts, engine=ENGINE))
    return H.fix(union([pl, H.nose_wedge(z0, -1)], engine=ENGINE))


def swivel_hub_f(geo, code):
    """The swivel carrier: hub, a deep stem that widens beyond the housing with a fillet, and the real plug."""
    z0, z1 = S.Z0, S.Z1
    body = H.cyl(H.R_H, 0, H.L_H)
    cuts = []
    for a in H.CLICKS:
        phi = 90 - a
        cuts += [H.groove(H.L_H, +1, phi), H.groove(0.0, -1, phi)]
    hub = H.fix(difference([body] + cuts, engine=ENGINE))
    W, L = H.ARM_W, F['STEM_END']
    far = F['STEM_W_FAR']
    outline = Polygon([(-W / 2, -(H.R_H - 0.5)), (-W / 2, -9.0), (-far / 2, -18.0), (-far / 2, -L), (far / 2, -L), (far / 2, -18.0), (W / 2, -9.0), (W / 2, -(H.R_H - 0.5))])
    stem = H.fix(extrude_polygon(outline, z1 - z0, engine='earcut')); stem.apply_translation([0, 0, z0])
    plug = C.plug_solid(geo, code)                  # in use: tip at z = 0, base at z = PLUG_LEN
    plug.apply_transform(H.rot_x(-90))              # its axis becomes the stem's
    plug.apply_translation([0, -L - C.PLUG_LEN, (z0 + z1) / 2])
    return H.fix(union([hub, stem, plug], engine=ENGINE))


# ---------------------------------------------------------------- the stress model
def sections(dims):
    """Section moduli and wall thicknesses for a set of dimensions (arm width is the same in both)."""
    W, T, L = H.ARM_W, dims['T_ARM'], dims['L_H']
    wall = (L - (T + 0.2)) / 2                      # hub above and below the socket
    return dict(Z_out=W * T * T / 6, Z_in=T * W * W / 6, wall=wall, wall_g=wall - H.H_G, A_arm=W * T)


def safety_table(dims, beam_L, beam_t, fortified, material):
    sig, endur = MATERIALS[material]['sig'], MATERIALS[material]['endurance']
    sec = sections(dims)
    lever = 8.0
    abuse_F = 15.0
    abuse_M = abuse_F * H.ARM_LEN
    carry = 2 * 460.0
    T_peak = H.torque_peak(H.T_DESIGN, 0.45)
    span = 2 * S.W_S
    contact = 3.0
    rows = []
    def add(name, stress):
        rows.append((name, stress, (sig if 'flexure' not in name else endur) / stress))
    # the hub walls: a plate loaded by the couple that carries the arm's sideways moment
    for lab, h in (('plain', sec['wall']), ('under a groove', sec['wall_g'])):
        Fc = abuse_M / lever
        add(f'hub wall over the socket ({lab}), arm shoved sideways', (Fc * span / 4) / (contact * h * h / 6))
    add('arm bar, in plane, shoved against the end stop', abuse_M / sec['Z_in'])
    kt = 1.6 if fortified else 3.0
    nominal = abuse_M / lever / sec['A_arm'] * 3
    add(f'tongue at the slit end ({"round" if fortified else "square"} corner), shoved', kt * nominal)
    k, sg = beam_stress(beam_L, beam_t)
    add(f'flexure beam, every click ({beam_t} mm, {beam_L:.1f} mm long)', sg)
    add('swivel stem, tilted, p90 worst x2', 2 * 379 / sec['Z_in'])
    add('arm bar, out of plane, shoved', abuse_M / sec['Z_out'])
    add('arm bar, out of plane, carried', carry / sec['Z_out'])
    add('swivel stem, hanging, biggest arm net', 402 / sec['Z_in'])
    add('arm bar, in plane, carried (detent slips first)', T_peak / sec['Z_in'])
    return rows


def beam_stress(L, t):
    k = H.E_PETG * H.BEAM_W * t ** 3 / (4 * L ** 3)
    sigma = 3 * H.E_PETG * t * H.DELTA0 / (2 * L ** 2)
    return k, sigma


# ---------------------------------------------------------------- checks on the real meshes
def run_checks(hub, arm, hsg, plate_top, plate_bot, swivel):
    out = {}
    free = {}
    for a in range(-60, 61, 5):
        h, r = H.turned(hub, a), H.turned(arm, a)
        free[a] = sum(H.overlap(m, g) for m in (h, r) for g in (hsg, plate_top, plate_bot))
    out['free_turn'] = free
    depths = [-20 + 0.25 * i for i in range(0, 81)]
    out['insertion'] = (depths, [H.overlap(arm_t(arm, s), hub) for s in depths])
    way = {}
    for a in (-50, 0, 50):
        worst = 0.0
        for d in range(0, 26, 2):
            m = H.turned(arm, a)
            ax = (math.sin(math.radians(a)), -math.cos(math.radians(a)))
            m.apply_translation([ax[0] * d, ax[1] * d, 0])
            worst = max(worst, H.overlap(m, hsg) + H.overlap(m, plate_top) + H.overlap(m, plate_bot))
        way[a] = worst
    out['way_out'] = way
    # retention: how much of the hub's length is held by a full ring when it is pulled down the slot
    held = []
    for d in (0.5, 1, 2, 4):
        m = hub.copy(); m.apply_translation([0, -d, 0])
        held.append((d, H.overlap(m, hsg)))
    out['retention'] = held
    sfree = {}
    for a in range(-60, 61, 10):
        sw = H.turned(swivel, a)
        sfree[a] = sum(H.overlap(sw, g) for g in (hsg, plate_top, plate_bot))
    out['swivel_free'] = sfree
    return out


def arm_t(arm, s):
    m = arm.copy(); m.apply_translation([0, s, 0]); return m


def ring_heights(hsg_slot_bot, hsg_slot_top, z_lo, z_hi):
    return max(0.0, hsg_slot_bot - z_lo), max(0.0, z_hi - hsg_slot_top)


def main():
    cats, modes, types, keys, accepts, cfg, asg = sp.design()
    geo = sp.Spokes(cfg)
    code = asg[frozenset({'D1'})]

    print('== current design: break points (PETG)')
    old_rows = safety_table(OLD, H.BEAM_L, H.T_DESIGN, False, 'PETG')
    for n, s, sf in sorted(old_rows, key=lambda r: r[2]): print(f'   {n:<64} {s:>6.1f} MPa  SF {sf:.2f}')

    with Patched():
        print('== fortified design')
        new_rows = {m: safety_table(F, H.BEAM_L, H.T_DESIGN, True, m) for m in MATERIALS}
        for n, s, sf in sorted(new_rows['PETG'], key=lambda r: r[2]):
            sfc = next(r[2] for r in new_rows['carbon-fibre nylon'] if r[0] == n)
            print(f'   {n:<64} {s:>6.1f} MPa  SF {sf:.2f} (carbon-fibre nylon {sfc:.2f})')
        k, sg = beam_stress(H.BEAM_L, H.T_DESIGN)
        peak = H.torque_peak(H.T_DESIGN, 0.0), H.torque_peak(H.T_DESIGN, 0.3), H.torque_peak(H.T_DESIGN, 0.45)
        print(f'   longer beams: {H.BEAM_L:.1f} mm, thickness {H.T_DESIGN} mm: stiffness {k:.1f} N/mm each (was 16.9), peak torque {peak[0]:.0f}/{peak[1]:.0f}/{peak[2]:.0f} N*mm (was 109/230/400)')

        hub = S.hub_q()
        arm = arm_f(1.3)
        slot_bot, slot_top = S.Z0 - 0.4, S.Z1 + 0.4
        hsg = H.housing(slot_top=slot_top, slot_bot=slot_bot)
        lid = lid_f(H.T_DESIGN)
        plate_top = H.lid_installed(H.T_DESIGN, with_nose=False); plate_bot = H.mirrored_bottom(plate_top)
        swivel = swivel_hub_f(geo, code)
        rings = ring_heights(slot_bot, slot_top, H.Z_LO, H.Z_HI)
        meshes = {'hub_q': hub, 'arm_q13': arm, 'housing': hsg, 'swivel_hub': swivel}
        for t in H.T_VARIANTS:
            meshes[f'lid_t{int(round(t * 10)):02d}'] = lid_f(t)
        health = {n: H.health(m) for n, m in meshes.items()}
        for n, m in meshes.items():
            m.export(os.path.join(OUT, f'fort_{n}.stl')); print(f'   {n}: {health[n]}')
        chk = run_checks(hub, arm, hsg, plate_top, plate_bot, swivel)
        T_design, variants = H.T_DESIGN, list(H.T_VARIANTS)
        beam_L = H.BEAM_L

    fails = []
    bad = [n for n, h in health.items() if not (h['watertight'] and h['volume'])]
    if bad: fails.append(f'bad meshes {bad}')
    inside = max(v for a, v in chk['free_turn'].items() if abs(a) <= 55)
    print(f'   arm and hub turning: overlap within +-55 degrees {inside:.3f} mm3; at +-60 {chk["free_turn"][60]:.2f}')
    if inside > 0.01: fails.append('arm or hub touches the housing within the swing')
    if chk['free_turn'][60] < 0.01: fails.append('slot-limit check not sensitive')
    depths, curve = chk['insertion']
    seated = curve[depths.index(0.0)]; peak_i = max(curve)
    d_eff = S.DELTA_B - S.CLR_X
    pred = 2 * (S.Z1 if False else (F['T_ARM'])) * 0.5 * (2 * d_eff / S.TANB) * d_eff
    print(f'   pushing the arm in: seated {seated:.3f} mm3, peak barb interference {peak_i:.2f} mm3 (predicted {pred:.2f})')
    if seated > 0.05: fails.append('arm interferes with the socket when seated')
    if abs(peak_i - pred) / pred > 0.15: fails.append('barb interference does not match the prediction')
    print('   pulling the arm out at -50/0/+50:', {a: round(v, 3) for a, v in chk['way_out'].items()})
    if max(chk['way_out'].values()) > 0.01: fails.append('the arm cannot be pulled out cleanly')
    print('   hub pulled down the slot (overlap with housing, mm3):', [(d, round(v, 1)) for d, v in chk['retention']], f'| rings {rings[0]:.1f} mm below and {rings[1]:.1f} mm above the arm (was 0 below and 2.4 above)')
    if min(v for d, v in chk['retention']) < 0.5: fails.append('the hub is not retained')
    sw_in = max(v for a, v in chk['swivel_free'].items() if abs(a) <= 50)
    print(f'   swivel hub with stem and plug turning to +-50: overlap {sw_in:.3f} mm3; at +-60 {chk["swivel_free"][60]:.2f}')
    if sw_in > 0.01: fails.append('the swivel stem or plug touches the housing')

    write_doc(old_rows, new_rows, health, chk, rings, beam_L, T_design, variants, peak, k, fails, pred, peak_i)
    json.dump(dict(old=[(n, s, sf) for n, s, sf in old_rows], new={m: [(n, s, sf) for n, s, sf in r] for m, r in new_rows.items()},
                   dims=F, checks=dict(free=chk['free_turn'], rings=rings)), open(os.path.join(OUT, 'fortify.json'), 'w'), indent=1, default=float)
    figure(old_rows, new_rows, os.path.join(OUT, 'safety.png'))
    if fails:
        print('FAILED:', *fails, sep='\n  '); sys.exit(1)
    print('all fortify checks passed')


def figure(old_rows, new_rows, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    def norm(n):
        if 'flexure' in n: return 'flexure beam, every click'
        if 'slit end' in n: return 'tongue at the slit end, shoved'
        return n
    o = {norm(r[0]): r[2] for r in old_rows}
    p = {norm(r[0]): r[2] for r in new_rows['PETG']}
    c = {norm(r[0]): r[2] for r in new_rows['carbon-fibre nylon']}
    order = sorted(o, key=lambda n: o[n])
    fig, ax = plt.subplots(figsize=(12, 6.4), facecolor='white')
    y = np.arange(len(order))
    ax.barh(y + 0.27, [o[n] for n in order], 0.26, color='#c0392b', label='current parts (PETG)')
    ax.barh(y, [p[n] for n in order], 0.26, color='#2f5db8', label='fortified (PETG)')
    ax.barh(y - 0.27, [c[n] for n in order], 0.26, color='#2a9d6f', label='fortified (carbon-fibre nylon)')
    ax.axvline(1, color='k', lw=1.2); ax.axvline(2, color='k', lw=0.8, ls='--')
    ax.set_xscale('log'); ax.set_yticks(y); ax.set_yticklabels(order, fontsize=9); ax.invert_yaxis()
    ax.set_xlabel('safety factor (log scale): 1 = at the allowable stress, dashed = 2'); ax.legend(frameon=False, loc='upper center', bbox_to_anchor=(0.5, -0.12), ncol=3)
    ax.set_title('Where the arm breaks, before and after fortifying', fontsize=13)
    fig.tight_layout(); fig.savefig(path, dpi=115)


def write_doc(old_rows, new_rows, health, chk, rings, beam_L, T_design, variants, peak, k, fails, pred, peak_i):
    def norm(n):
        if 'flexure' in n: return 'flexure beam, every click'
        if 'slit end' in n: return 'tongue at the slit end, shoved'
        return n
    o = {norm(r[0]): r for r in old_rows}
    p = {norm(r[0]): r for r in new_rows['PETG']}
    c = {norm(r[0]): r for r in new_rows['carbon-fibre nylon']}
    order = sorted(o, key=lambda n: o[n][2])
    L = ['# Fortifying the swivel arm\n',
         'Generated by `physical/fortify.py`. Parts: `physical/hinge/fortified/`. Figure: `physical/hinge/fortified/safety.png`.\n',
         '**Yes, and it needs it.** I checked every likely break point by hand calculation, using the loads from the game\'s own trees (HINGE.md) plus an abuse case '
         '(someone shoves or grabs the arm tip with 15 N). Several parts of the current design are under a safety factor of 1; the worst by a wide margin is the hub '
         'around the quick-release socket. The fortified parts below were built and checked on the real meshes, and the numbers recomputed.\n',
         '## Where it breaks now, and after fortifying\n',
         'Safety factor = allowable stress ÷ stress. Below 1 means it breaks. Allowables are assumptions for printed material under repeated loading: **PETG 20 MPa** (about half its strength), '
         '**carbon-fibre nylon 40 MPa**, and for the flexure beams a fatigue endurance of 12 MPa (PETG) and 22 MPa. They are calculations by beam theory, not tests.\n',
         '| Break point | now (PETG) | fortified, PETG | fortified, carbon-fibre nylon |', '|---|---|---|---|']
    for n in order:
        L.append(f'| {n} | **{o[n][2]:.2f}** ({o[n][1]:.0f} MPa) | **{p[n][2]:.2f}** ({p[n][1]:.0f} MPa) | **{c[n][2]:.2f}** |')
    L += ['', '![safety factors](safety.png)\n',
          '## What was weak, and what changed\n',
          '**1. The hub walls around the quick-release socket (safety factor 0.06 to 0.19).** The socket takes out most of the middle of a 12 mm hub, leaving 1.9 mm of wall above and below it, '
          'and only 1.0 mm under a groove. A sideways push on the arm is carried through those thin walls as a couple. '
          f'*Fix:* a longer hub (**24 mm**) and a deeper arm (**12 mm**), so the walls are about {sections(F)["wall"]:.1f} mm ({sections(F)["wall_g"]:.1f} mm under a groove). '
          'The hub is a cylinder, so the extra length costs depth, not tree width.\n',
          '**2. The hub is only held in by a thin ring.** While checking this I found that the arm slot is open to the floor and its opening (12.4 mm) is wider than the hub (12.0 mm), '
          'so the only thing stopping the hub dropping out of the slot was a 2.4 mm ring above the arm. '
          f'*Fix:* the slot now covers only the arm\'s own height, leaving a **full ring {rings[0]:.1f} mm below and {rings[1]:.1f} mm above** the arm. They hold the hub in and carry the sideways load. '
          '(Measured: pulling the hub down the slot, the housing now blocks it at once, overlap ' + ', '.join(f'{v:.0f} mm³ at {d} mm' for d, v in chk['retention'][:3]) + '.)\n',
          '**3. The arm against its end stop, in plane (0.56).** If the arm is pushed past ±55° the arm\'s edge hits the slot wall with the whole arm as a lever. A thicker arm helps '
          f'(the section modulus goes up {sections(F)["Z_in"] / sections(OLD)["Z_in"]:.1f}×); the rest has to come from the material. This is the one that carbon-fibre nylon fixes and PETG does not. '
          '**Recommendation: print arms and stems in carbon-fibre nylon, or glue a Ø3 mm steel or carbon rod through the arm\'s length** (that adds strength for the cost of a hole; I have not calculated how much).\n',
          '**4. The slit end in the tongue (0.59).** A square corner at the end of the slit concentrates the stress about three times. *Fix:* a full round at the slit end (concentration about 1.6).\n',
          f'**5. The flexure beams (0.83 against fatigue).** They are bent every click. *Fix:* longer beams ({beam_L:.1f} mm instead of 12.5) with a thicker section ({T_design} mm instead of 2.0), '
          f'which gives the same stiffness ({k:.1f} N/mm each) at a stress about {100 * (1 - (beam_stress(beam_L, T_design)[1] / beam_stress(12.5, 2.0)[1])):.0f}% lower, and rounded slot ends where the beam joins the lid. '
          f'The peak detent torque stays at {peak[0]:.0f} / {peak[1]:.0f} / {peak[2]:.0f} N·mm (was 109 / 230 / 400).\n',
          f'**6. The swivel stem (0.88 tilted).** The stem at the arm tip carries the child\'s whole subtree. *Fix:* 12 mm deep like the arm, and it **widens beyond the housing** '
          f'(5 mm at the hub, {F["STEM_W_FAR"]:.0f} mm from 18 mm out) with straight tapers, rather than a bar. It must stay 5 mm wide inside the housing slot or it would hit the slot at ±50°.\n',
          '**7. The arm bar bending out of plane (0.89 shoved, 1.16 carried).** The 12 mm depth fixes it (section modulus ×2.25).\n',
          f'**8. The hanger hole in the test arm (a Ø4 hole in a 5 mm bar leaves 0.5 mm ligaments).** The test arm now has a flared boss ({F["BOSS_W"]:.0f} mm wide) round it. A production arm has no hole.\n',
          '## What the script checked on the real meshes\n',
          f'- All parts are watertight solids ({len(health)} of them).',
          f'- With the longer hub and deeper arm, **the arm still turns freely through ±55°** (overlap {max(v for a, v in chk["free_turn"].items() if abs(a) <= 55):.3f} mm³) and touches at ±60°.',
          f'- The swivel hub with its stem and the real plug turns through ±50° without touching the housing (overlap {max(v for a, v in chk["swivel_free"].items() if abs(a) <= 50):.3f} mm³).',
          f'- Pushing the arm in, the barbs interfere by {peak_i:.2f} mm³ (predicted {pred:.2f}); seated, nothing interferes; it pulls out clean at −50°, 0° and +50°.\n',
          '## What is not fixed, or not known\n',
          '- **A hard shove can still break a PETG arm.** The one case PETG cannot cover is the in-plane shove against the end stop (safety factor under 1). Either use carbon-fibre nylon or a rod, or accept that arms are the consumable part: they are the same part everywhere and snap in and out.',
          '- **Printing matters as much as geometry.** Arms and stems should be printed lying flat so the layers run along them (never standing up), with at least four perimeters; the hub with its axis vertical. Layer adhesion is the usual first failure.',
          '- **A fuse.** The best protection is a part that fails first and is cheap to replace. Here the arm is that part, which is why it should snap out and not be glued in.',
          '- **The numbers are calculated.** The load cases (15 N shove, doubling for handling) and the material allowables are my assumptions. Printing the three arm variants and loading them is the real test; the document before this (STOW.md) says how.',
          '- **The swivel is still only a concept** (ARM_OPTIONS.md): this builds its carrier hub and stem, not the whole tip cartridge, and the layout test says it makes trees 20 to 30% taller.']
    if fails:
        L += ['', '## CHECK FAILURES', *[f'- {x}' for x in fails]]
    open(os.path.join(HERE, 'FORTIFY.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
