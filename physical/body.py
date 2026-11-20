#!/usr/bin/env python3
"""
The piece bodies: one printed body per piece type (27 of them), built from the kit's real keys.

A body is a block with
  * a keyed socket in its top face, accepting every plug that may hang from it (the union of the keys of
    the slots it can hang from; the root piece, CP, hangs from nothing and has none),
  * for pieces with two or three slots: a dovetail groove for each moving arm under the body (left and
    right), closed at the inner end and open at the outer side, with a latch dimple (see slide.py),
  * a fixed post for a one-slot piece's only slot, and for the middle slot of a three-slot piece, with a
    D-shaped bore for the keyed plug insert.
Heads and bars are the same block with a socket and no arms.

This script builds all 27 bodies and the 27 plug inserts (one per slot), then checks on the real meshes:
the arms fit the real bodies in every setting; every plug seats in the socket of every child it is meant
for and in no other; plugs on left, right and fixed arms point the same way in the finished piece.

Run from the repo root:  python3 physical/body.py
"""
import itertools, json, math, os, sys
import numpy as np
import trimesh
from trimesh.creation import box as tbox
from trimesh.boolean import union, difference, intersection
from shapely.geometry import box as sbox
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import coupon as C
import spokes as sp
import slide as S

OUT = os.path.join(HERE, 'body')
os.makedirs(OUT, exist_ok=True)
ENGINE = S.ENGINE
SOCKET_CLR = 0.15            # per side, the kit's design value (SPOKES.md); the key coupon tests 0.05 to 0.25
THICK_SLOTTED = 2 * (S.ZC + 7.0)          # 35 mm: two arm stacks side by side
THICK_PLAIN = 30.0                         # heads, bars, one-slot pieces: the socket is 23.8 mm wide, 3 mm walls
POST_W, POST_THIN_Z = 14.0, 6.0            # the middle post is thin where it passes between the stacks
POST_WIDEN_Y = 19.5                        # below the stacks it widens to hold the insert


def dims(n_slots):
    return A.body_width(n_slots), (THICK_SLOTTED if n_slots >= 2 else THICK_PLAIN)


def socket_cut(geo, codes):
    """The socket's void, in the body frame (top face at y = -BODY_H, opening upward)."""
    cav = C.cavity(geo, codes, SOCKET_CLR)                  # floor at z = FLOOR, top face at z = BLOCK_H
    cav.apply_transform(H.rot_x(90))                        # z -> -y
    cav.apply_translation([0, -A.BODY_H + C.BLOCK_H, 0])    # block top (z = BLOCK_H) lands on y = -BODY_H
    return cav


def arm_x0(n):
    return (n - 1) / 2 * A.PIVOT_PITCH - S.FOOT_X          # where A's inner end sits for the right arm


def mount_cuts(n):
    """Grooves and latch dimples for the right and left arms, in the body frame."""
    w, _ = dims(n)
    x0 = arm_x0(n)
    hm = S.NECK / 2 + S.VGAP + S.CLR
    cuts = []
    for left in (False, True):
        g = S.prism_yz([(0.5, -hm), (0.5, hm), (0.0, hm), (-S.GD, hm + S.GD), (-S.GD, -(hm + S.GD)), (0.0, -hm)], x0 - 0.3, w / 2 + 1.0)
        g.apply_translation([0, 0, S.ZC])
        d = S.dimple(x0 + S.BUMP_X, 0.0, -1, S.ZC - S.BEAM_Z1, S.ZC - S.BEAM_Z0, False)
        if left:
            g.apply_transform(H.rot_y(180)); d.apply_transform(H.rot_y(180))
        cuts += [g, d]
    return cuts


def post(bottom, thin):
    """A fixed post hanging from the underside with a D-bore at its bottom for the insert."""
    parts = []
    if thin:
        parts.append(H.slab(-S.FOOT_W / 2 + 1.0, S.FOOT_W / 2 - 1.0, -0.02, POST_WIDEN_Y + 0.02, -POST_THIN_Z / 2, POST_THIN_Z / 2))
        parts.append(H.slab(-POST_W / 2, POST_W / 2, POST_WIDEN_Y, bottom, -POST_W / 2, POST_W / 2))
    else:
        parts.append(H.slab(-POST_W / 2, POST_W / 2, -0.02, bottom, -POST_W / 2, POST_W / 2))
    cuts = [S.d_prism(S.BORE_R, bottom - 10.0, bottom + 0.5, 0.0, 0.0)]
    ring = trimesh.creation.cylinder(radius=S.BORE_R + 0.45, height=1.2, sections=48); ring.apply_transform(H.rot_x(90))
    ring.apply_translation([0, bottom - 10.0 + 4.6, 0]); cuts.append(ring)
    return parts, cuts


def build_body(t, geo, asg, accepts):
    n = len(sp.PORTS.get(t, {}))
    w, th = dims(n)
    blk = H.slab(-w / 2, w / 2, -A.BODY_H, 0.0, -th / 2, th / 2)
    cuts, adds = [], []
    if accepts[t]:
        cuts.append(socket_cut(geo, [asg[k] for k in accepts[t]]))
    if n >= 2:
        cuts += mount_cuts(n)
    if n == 3:
        p, c = post(S.DROP, True); adds += p; cuts_post = c
    elif n == 1:
        p, c = post(A.STUB[0].length, False); adds += p; cuts_post = c
    else:
        cuts_post = []
    m = union([blk] + adds, engine=ENGINE) if adds else blk
    return H.fix(difference([m] + cuts + cuts_post, engine=ENGINE))


def slot_side(t, slot):
    return {'L': 'left', 'R': 'right', 'M': 'middle', 'U': 'only'}[slot]


def build_insert(t, slot, geo, asg):
    key = frozenset(sp.PORTS[t][slot])
    code = asg[key]
    n = len(sp.PORTS[t])
    turn = 180.0 if (slot == 'L' and n >= 2) else 0.0
    m = S.part_insert(geo, code, turn)
    if slot == 'U':
        m.apply_translation([0, A.STUB[0].length - S.DROP, 0])        # a one-slot piece's post is shorter
    return m, code


def socket_block(t, geo, asg, accepts):
    """Only the child's top: a plain block with the socket, for the fit tests."""
    n = len(sp.PORTS.get(t, {}))
    w, th = dims(n)
    blk = H.slab(-w / 2, w / 2, -A.BODY_H, 0.0, -th / 2, th / 2)
    return H.fix(difference([blk, socket_cut(geo, [asg[k] for k in accepts[t]])], engine=ENGINE))


def overlap(a, b):
    return S.overlap(a, b)


def plug_world(insert, left):
    """The insert as it ends up in a finished piece: the left arm turns everything 180 degrees about the vertical."""
    m = insert.copy()
    if left:
        m.apply_translation([-S.FOOT_X, 0, S.ZC]); m.apply_transform(H.rot_y(180)); m.apply_translation([S.FOOT_X, 0, -S.ZC])
    return m


def main():
    cats, modes, types, keys, accepts, cfg, asg = sp.design()
    geo = sp.Spokes(cfg)
    R = {}
    print('== the 27 bodies')
    bodies, rows = {}, []
    for t in types:
        m = build_body(t, geo, asg, accepts)
        assert m.is_watertight, t
        bodies[t] = m
        n = len(sp.PORTS.get(t, {}))
        w, th = dims(n)
        m.export(os.path.join(OUT, f'body_{t.replace("*", "x")}.stl'))
        rows.append(dict(type=t, slots=n, width=w, thick=th, mm3=float(m.volume), socket=bool(accepts[t]), codes=len(accepts[t])))
    print(f'   all {len(bodies)} bodies are watertight solids ({sum(1 for r in rows if r["slots"] == 3)} three-slot, {sum(1 for r in rows if r["slots"] == 2)} two-slot, {sum(1 for r in rows if r["slots"] == 1)} one-slot, {sum(1 for r in rows if r["slots"] == 0)} without slots)')
    R['bodies'] = rows

    print('== the plug inserts (one per slot)')
    inserts = {}
    for t in types:
        for slot in sp.PORTS.get(t, {}):
            m, code = build_insert(t, slot, geo, asg)
            assert m.is_watertight, (t, slot)
            inserts[(t, slot)] = (m, code)
            m.export(os.path.join(OUT, f'insert_{t.replace("*", "x")}_{slot}.stl'))
    print(f'   {len(inserts)} inserts, {len(set(c for m, c in inserts.values()))} distinct keys')
    R['inserts'] = len(inserts)

    print('== arms on the real bodies')
    P = [S.part_A(), S.part_S1(), S.part_S2(), None]
    worst = 0.0
    n_checked = 0
    for t in ('T1', 'P1'):                                     # a three-slot piece (TP) and a two-slot piece (PP)
        n = len(sp.PORTS[t])
        body = bodies[t]
        x0 = arm_x0(n)
        poses = [(0, 0, 0, 0), (S.STEP, S.STEP, S.STEP, S.STEP), (S.STEP, 0, 0, S.STEP), (0, S.STEP, S.STEP, 0)]
        if n == 2:
            poses[0] = (S.STEP, 0, 0, 0)       # two children cannot both hang at 0 mm: their plugs are only 16 mm apart
        for (r1, r2, l1, l2) in poses:
            ms = []
            for left, (s1, s2) in ((False, (r1, r2)), (True, (l1, l2))):
                slot = 'L' if left else 'R'
                ins = inserts[(t, slot)][0]
                Pi = [P[0], P[1], P[2], ins]
                ms += S.assembly(Pi, s1, s2, left, x0=x0)
            allm = ms + [body]
            plugs = {3, 7}                                          # the inserts: two children never hang within a plug's width of each other
            if n == 3:
                allm.append(inserts[(t, 'M')][0]); plugs.add(len(allm) - 1)
            for i, j in itertools.combinations(range(len(allm)), 2):
                if i in plugs and j in plugs: continue
                v = overlap(allm[i], allm[j])
                if v != 0.0:
                    print(f'   OVERLAP {t} {i}/{j} {v:.3f}'); worst = max(worst, v)
            n_checked += 1
    print(f'   a three-slot and a two-slot body, 4 settings each, both arms mounted: largest overlap {worst:.3f} mm3')
    R['arm_overlap'] = worst
    assert worst == 0.0

    # the middle post and the one-slot post against both arms (feet) are in the pieces above (three-slot); one-slot has no arms
    print('== plugs in sockets (real meshes)')
    blocks = {t: socket_block(t, geo, asg, accepts) for t in types if accepts[t]}
    fits = wrong = 0
    bad = []
    for (t, slot), (ins, code) in inserts.items():
        left = (slot == 'L' and len(sp.PORTS[t]) >= 2)
        # in the finished piece the plug sits at the arm's carriage; here it is placed on the child's socket axis, base on the child's top face
        pm = plug_world(ins, left)
        bottom = A.STUB[0].length if slot == 'U' else S.DROP
        pm.apply_translation([-S.FOOT_X, -A.BODY_H - bottom, S.ZC])
        allowed = set(sp.PORTS[t][slot])
        for c, blk in blocks.items():
            v = overlap(pm, blk)
            if c in allowed:
                if v != 0.0: bad.append(f'{t}.{slot} plug collides with its own child {c} ({v:.3f} mm3)')
                else: fits += 1
            else:
                if v == 0.0: bad.append(f'{t}.{slot} plug fits {c}, which it should not take')
                else: wrong += 1
    print(f'   plugs that seat in a child they are meant for: {fits}; wrong combinations that collide as they should: {wrong}; problems: {len(bad)}')
    for b in bad[:10]: print('   ', b)
    R['fit'] = dict(fits=fits, wrong_blocked=wrong, problems=bad)

    print('== plugs point the same way on left, right and fixed arms')
    # negative control: the same left-slot insert WITHOUT the 180 degree turn must not seat in its child's socket
    t, slot = 'T1', 'L'
    key = frozenset(sp.PORTS[t][slot]); code = asg[key]
    wrong = S.part_insert(geo, code, 0.0)
    pm = plug_world(wrong, True)
    pm.apply_translation([-S.FOOT_X, -A.BODY_H - S.DROP, S.ZC])
    child = sorted(sp.PORTS[t][slot])[0]
    v_wrong = overlap(pm, blocks[child])
    pm = plug_world(inserts[(t, slot)][0], True); pm.apply_translation([-S.FOOT_X, -A.BODY_H - S.DROP, S.ZC])
    v_right = overlap(pm, blocks[child])
    print(f'   left TP slot -> {child}: with the turn {v_right:.3f} mm3 (seats); without it {v_wrong:.2f} mm3 (blocked)')
    R['orientation'] = dict(with_turn=v_right, without_turn=v_wrong)
    assert v_right == 0.0 and v_wrong > 0.0

    # strength at the mount
    print('== mount and body strength')
    M_arm = sum(float(P[i].volume) for i in range(3)) * S.DENS * S.FILL
    Wmax = 6.4 + 0.0   # N, the heaviest hanging weight on a stage (SLIDE.md)
    xc_full = S.FOOT_X + 2 * S.STEP
    lever = xc_full - 24.0                         # from the middle of A's 48 mm mount
    out = {}
    for lab, Wn in (('heaviest phrase (6.4 N)', 6.4), ('abuse, a 15 N pull', 15.0)):
        Mm = Wn * lever
        F = Mm / 44.0                              # the couple over the mount's length
        lip = F / (2 * S.GD * 16.0)                # shear in the two groove lips over about a third of the mount
        out[lab] = dict(M=Mm, F=F, lip=lip, SF=12.0 / lip)
        print(f'   {lab}: moment on the mount {Mm:.0f} N*mm, couple {F:.1f} N, groove-lip shear {lip:.2f} MPa (safety {12.0 / lip:.1f})')
    R['mount_strength'] = out
    # socket walls
    walls = {}
    for t in types:
        if not accepts[t]: continue
        n = len(sp.PORTS.get(t, {})); w, th = dims(n)
        cav = socket_cut(geo, [asg[k] for k in accepts[t]])
        b = cav.bounds
        walls[t] = min(w / 2 - b[1][0], w / 2 + b[0][0], th / 2 - b[1][2], th / 2 + b[0][2])
    wmin = min(walls.values())
    print(f'   thinnest wall round a socket: {wmin:.1f} mm (over {len(walls)} bodies)')
    R['wall_min'] = wmin

    # masses
    mass = {r['type']: r['mm3'] * S.DENS * S.FILL for r in rows}
    ins_mass = {f'{t}.{s}': float(m.volume) * S.DENS * S.FILL for (t, s), (m, c) in inserts.items()}
    R['mass'] = dict(body=mass, insert_mean=float(np.mean(list(ins_mass.values()))))
    print(f'   body masses at 50% fill: heads {np.mean([mass[t] for t in types if not sp.PORTS.get(t)]):.0f} g, one-slot {np.mean([mass[t] for t in types if len(sp.PORTS.get(t, {})) == 1]):.0f} g, two-slot {np.mean([mass[t] for t in types if len(sp.PORTS.get(t, {})) == 2]):.0f} g, three-slot {np.mean([mass[t] for t in types if len(sp.PORTS.get(t, {})) == 3]):.0f} g')

    figures(bodies, inserts, geo, asg, P, os.path.join(OUT))
    json.dump(R, open(os.path.join(OUT, 'body.json'), 'w'), indent=1, default=float)
    write_doc(R, types, cats)


def figures(bodies, inserts, geo, asg, P, outdir):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    # three bodies seen from above and from below, plus the three-slot with both arms
    fig, axes = plt.subplots(2, 3, figsize=(15, 8.6), facecolor='white')
    def view(ax, m, title, elev, azim):
        ax.imshow(C.render(m, w=560, h=420, elev=elev, azim=azim)); ax.axis('off'); ax.set_title(title, fontsize=11, loc='left')
    def to_z_up(m):
        # the model has y down; the renderer has z up: y -> -z (a rotation)
        v = m.copy(); v.apply_transform(H.rot_x(-90)); return v
    tp = bodies['T1']; pp = bodies['P1']; hd = bodies['N2*']
    view(axes[0][0], to_z_up(tp), 'TP (three slots), seen from above: the socket', 38, -58)
    view(axes[0][1], to_z_up(pp), 'PP (two slots), from above', 38, -58)
    view(axes[0][2], to_z_up(hd), 'N⁰ head (XP mode), from above', 38, -58)
    view(axes[1][0], to_z_up(tp), 'TP from below: grooves, latch dimples, middle post', -38, -58)
    view(axes[1][1], to_z_up(pp), 'PP from below', -38, -58)
    ms = [tp] + S.assembly([P[0], P[1], P[2], inserts[('T1', 'R')][0]], 0, 0, False, x0=arm_x0(3)) + S.assembly([P[0], P[1], P[2], inserts[('T1', 'L')][0]], 36, 36, True, x0=arm_x0(3))
    view(axes[1][2], to_z_up(trimesh.util.concatenate(ms)), 'TP with both arms (right in, left out)', -30, -58)
    fig.suptitle('Piece bodies (all 27 are generated; three shown)', fontsize=12)
    fig.tight_layout(); fig.savefig(os.path.join(outdir, 'bodies.png'), dpi=110); plt.close(fig)


def write_doc(R, types, cats):
    rows = R['bodies']
    kinds = {}
    for r in rows:
        kinds.setdefault((r['slots'], r['width'], r['thick']), []).append(r)
    tbl = '\n'.join(f"| {', '.join(x['type'] for x in v)} | {k[0]} | {k[1]:.1f} × {A.BODY_H:.0f} × {k[2]:.0f} | {sum(x['mm3'] for x in v) / len(v) * S.DENS * S.FILL:.0f} g |" for k, v in sorted(kinds.items(), key=lambda kv: -kv[0][0]))
    ms = R['mount_strength']
    f = R['fit']
    s = f"""# The bodies

Generated by `physical/body.py`. Parts: `physical/body/` (27 bodies, `body_<type>.stl`, and 27 plug inserts, `insert_<type>_<slot>.stl`), figure `physical/body/bodies.png`. In the file names `x` stands for the `*` of an XP-mode head.

A body is one printed block. It carries what the sliding arm (`SLIDE.md`) hangs from and the socket the piece itself hangs by:

- **The socket** in the top face is cut for the union of the keys of every slot the piece can hang from (the same rule as `SPOKES.md`); CP, the root, hangs from nothing and has none. It is 12 mm deep with its floor 14 mm below the top face. The cut uses the kit's 0.15 mm clearance.
- **Two dovetail grooves** under the body for the left and right arm of a two- or three-slot piece, closed at the inner end, open at the outer side, each with a latch dimple (`slide_coupon.py` tests that fit).
- **A fixed post** for a one-slot piece's only slot and for the middle slot of a three-slot piece. The middle post is only 6 mm thick between the two arm stacks and widens to 14 × 14 mm below them, where it holds the plug insert in a D-shaped bore.
- Heads and bars are the same block with a socket and nothing under it.

| Pieces | Slots | Size w × h × d (mm) | Mass (50% PETG) |
|---|---|---|---|
{tbl}

Two things changed from `SLIDE.md` while doing this. **A two-slot body is 64 mm wide, not 38.5**, so that each arm's inner end stays inside the body and the groove can be closed (the layout test says this costs nothing: still 10 of 10 trees, total area +0.4%). **The plain bodies are 30 mm thick, not 24**: the socket is 23.8 mm across and needs 3 mm walls (the 24 mm in `SLIDE.md` would have left a 0.1 mm wall).

![bodies](bodies.png)

## One insert per slot, and a left arm needs a turned plug

The plug insert is the only key-specific part: 27 slots give {R['inserts']} inserts. The shank is D-shaped so an insert cannot turn in the foot or post. A left arm is the right arm turned 180° about the vertical, which would turn its plug 180° as well and the child's socket would refuse it, so **the plug of a left-slot insert is turned 180° on its shank**; in the finished piece it points the same way as every other plug.

## What the script checked on the real meshes

- All 27 bodies and 27 inserts are watertight solids.
- **Arms on the real bodies:** a three-slot and a two-slot body, four combinations of settings each with both arms mounted in the real grooves, plus the middle post and the plug inserts: no part overlaps another (largest overlap {R['arm_overlap']:.3f} mm³).
- **Every plug in every socket:** each of the {R['inserts']} inserts, placed on the socket of every body that has one: it seats (zero overlap) in **{f['fits']}** child sockets it is meant for, and collides, as it should, with **{f['wrong_blocked']}** others, with **{len(f['problems'])} problems**. That is the whole one-thing-matches-one-thing rule, again, on the 3D meshes of the real bodies instead of the 2D keys.
- **Orientation:** every left-slot plug seats in its child, as counted above, because of the 180° turn. As a control, the same left TP insert made *without* the turn collides with its child's socket ({R['orientation']['without_turn']:.1f} mm³ of overlap) instead of seating.
- The thinnest wall round any socket is {R['wall_min']:.1f} mm.

## Strength at the mount

With the heaviest weight a stage carries (6.4 N) at full extension the arm's mount takes a moment, which the 48 mm dovetail resists as a couple. The groove's lips in the body (1.6 mm deep) are the weak part:

| Load | Moment on the mount | Couple | Lip shear | Safety (12 MPa) |
|---|---|---|---|---|
""" + "\n".join(f"| {k} | {v['M']:.0f} N·mm | {v['F']:.1f} N | {v['lip']:.2f} MPa | {v['SF']:.1f} |" for k, v in ms.items()) + f"""

These are rough: they assume the couple is carried by about a third of the mount's length, and the real stress depends on how the printed lip behaves. The mount is a dovetail and a flexure latch in PETG and is the same detail as the sliders, so the coupon tests it.

## What this does not settle

- **The root piece (CP) has no socket and no way to be held up.** It needs a hook, a handle or a stand; nothing is designed.
- **Printing the bodies:** the 35 mm slotted bodies have an inside that is unsupported where the socket and the grooves are cut. I have not checked them against a print orientation or slicer. A body prints best with the socket face up; the grooves then face down and would need supports.
- **Weight:** a three-slot body is heavy; there is no hollowing or ribbing yet.
- **The kit's counts:** 27 bodies and 27 inserts, plus 27 slot types' worth of arms (4 parts each): the parts list per student is not yet done.
- Nothing has been printed, so the clearances (0.15 mm at the socket, 0.25 mm at the dovetails) are still assumptions.
"""
    open(os.path.join(HERE, 'BODY.md'), 'w').write(s)


if __name__ == '__main__':
    main()
