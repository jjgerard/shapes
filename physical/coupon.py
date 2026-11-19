#!/usr/bin/env python3
"""
STL test coupon for the circle-and-spokes connectors.

Three small parts, all printed as modelled, no supports:
  coupon_plugs.stl             4 plugs standing on a plate (3 real keys + a spare)
  coupon_clearance_sockets.stl 5 sockets, same key, clearance 0.05 ... 0.25 mm
  coupon_key_sockets.stl       3 real sockets (DP, PP, NP) at the design clearance

They answer, on a real printer:
  1. Which clearance gives a good fit?                   (clearance block)
  2. Does a wrong key refuse, and does a slot that takes
     several shapes really take all of them?             (3 plugs x 3 sockets)
  3. Is there only one way in?                           (turn a plug)

The plugs and sockets are the kit's own (same keys, spoke angles and core size
as the sheet in out/spokes.png), taken from spokes.design().

The script then checks the real meshes in 3D: it seats every plug in every
socket and measures the overlap, and it turns plugs to every other spoke
position. Fits must overlap by 0; wrong pairs and wrong rotations must overlap.

Run from the repo root:  python3 physical/coupon.py
"""
import json, math, os, sys
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon, cylinder, box
from trimesh.boolean import union, difference, intersection
from shapely.geometry import MultiPolygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spokes as sp

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'coupon')
os.makedirs(OUT, exist_ok=True)
ENGINE = 'manifold'

# --- dimensions (mm) ---------------------------------------------------------
LA, LB = 6.0, 6.0               # plug: tip zone A, base zone B
PLUG_LEN = LA + LB
FLOOR = 2.0                     # socket floor thickness
SLACK = 0.4                     # where the shallow zone starts, above the seated tip zone
BLOCK_H = FLOOR + PLUG_LEN      # plug seats flush with the block top
PLATE_T = 2.0
CHAMFER = 0.4                   # lead-in on plug tip and socket mouth
PIT_R, PIT_DEPTH, PIT_PITCH = 0.75, 0.8, 2.8
CELL_W, CELL_H = 31.0, 34.0     # one socket cell
CLEARANCES = [0.05, 0.10, 0.15, 0.20, 0.25]


def slabs(geom, z0, z1):
    out = []
    for p in (geom.geoms if isinstance(geom, MultiPolygon) else [geom]):
        m = extrude_polygon(p.buffer(0), z1 - z0, engine='earcut')
        m.apply_translation([0, 0, z0])
        out.append(m)
    return out


def fuse(meshes):
    return union(meshes, engine=ENGINE) if len(meshes) > 1 else meshes[0]


def plug_solid(geo, code):
    """The plug in use: tip at z=0, base at z=PLUG_LEN."""
    tip, prox = geo.plug(code)
    parts = (slabs(tip.buffer(-CHAMFER), 0, CHAMFER) +
             slabs(tip.buffer(-CHAMFER / 2), CHAMFER, 2 * CHAMFER) +
             slabs(tip, 2 * CHAMFER, LA) + slabs(prox, LA, PLUG_LEN))
    return fuse(parts)


def cavity(geo, codes, clr):
    """The socket's void, floor at z=FLOOR, open above the block top."""
    deep, shallow = geo.socket(codes, clr)
    top = BLOCK_H + 0.6
    parts = (slabs(deep, FLOOR, FLOOR + LA - SLACK) + slabs(shallow, FLOOR + LA - SLACK, top) +
             slabs(shallow.buffer(CHAMFER / 2), BLOCK_H - 1.5 * CHAMFER, top) +
             slabs(shallow.buffer(CHAMFER), BLOCK_H - CHAMFER, top))
    return fuse(parts)


def pits(n, cx, cy, z_top):
    ms = []
    for i in range(n):
        m = cylinder(radius=PIT_R, height=2 * PIT_DEPTH, sections=24)
        m.apply_translation([cx + (i - (n - 1) / 2) * PIT_PITCH, cy, z_top])
        ms.append(m)
    return ms


def socket_block(geo, specs, cols):
    """specs: list of (codes, clearance, pit_count). Returns (mesh, centres)."""
    rows = math.ceil(len(specs) / cols)
    W, D = cols * CELL_W + 8, rows * CELL_H + 8
    blk = box(extents=[W, D, BLOCK_H])
    blk.apply_translation([0, 0, BLOCK_H / 2])
    cuts, centres = [], []
    for i, (codes, clr, npits) in enumerate(specs):
        cx = -W / 2 + 4 + CELL_W * (i % cols + .5)
        cy = D / 2 - 4 - CELL_H * (i // cols + .5) + 2
        c = cavity(geo, codes, clr)
        c.apply_translation([cx, cy, 0])
        cuts.append(c)
        cuts += pits(npits, cx, cy - 14.5, BLOCK_H)
        centres.append((cx, cy))
    return difference([blk] + cuts, engine=ENGINE), centres


def plug_plate(geo, plugs, cols=2):
    """plugs: list of (code, pit_count), standing tip-up on a plate."""
    pitch = 30.0
    rows = math.ceil(len(plugs) / cols)
    W, D = cols * pitch + 6, rows * (pitch + 4) + 4
    plate = box(extents=[W, D, PLATE_T])
    plate.apply_translation([0, 0, PLATE_T / 2])
    items, centres = [plate], []
    cuts = []
    for i, (code, npits) in enumerate(plugs):
        cx = -W / 2 + 3 + pitch * (i % cols + .5)
        cy = D / 2 - 2 - (pitch + 4) * (i // cols + .5) + 1
        p = plug_solid(geo, code)
        p.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0]))   # tip up
        p.apply_translation([cx, cy, PLUG_LEN + PLATE_T])
        items.append(p)
        cuts += pits(npits, cx, cy - 15.2, PLATE_T)
        centres.append((cx, cy))
    return difference([fuse(items)] + cuts, engine=ENGINE), centres


def health(m):
    return dict(watertight=bool(m.is_watertight), volume=bool(m.is_volume), mm3=float(m.volume),
                bounds=[round(float(x), 1) for x in m.extents])


def overlap(a, b):
    r = intersection([a, b], engine=ENGINE)
    return float(r.volume) if len(r.faces) else 0.0


def seated(plug, cx, cy, turn_deg=0.0):
    p = plug.copy()
    if turn_deg:
        p.apply_transform(trimesh.transformations.rotation_matrix(math.radians(turn_deg), [0, 0, 1]))
    p.apply_translation([cx, cy, FLOOR])
    return p


def render(mesh, w=640, h=500, elev=36.0, azim=-58.0, ss=2):
    """Small z-buffer renderer (orthographic, Lambert shading, 2x supersampled)
    -- matplotlib's painter's algorithm mis-sorts the large flat faces."""
    W, H = w * ss, h * ss
    e, a = math.radians(elev), math.radians(azim)
    cam = np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
    right = np.cross([0, 0, 1], cam); right /= np.linalg.norm(right)
    up = np.cross(cam, right)
    V = mesh.vertices - mesh.bounds.mean(axis=0)
    sx, sy, dz = V @ right, V @ up, V @ cam
    scale = 0.9 * min(W / (sx.max() - sx.min()), H / (sy.max() - sy.min()))
    px = W / 2 + sx * scale
    py = H / 2 - sy * scale
    light = np.array([0.35, -0.45, 0.82]); light /= np.linalg.norm(light)
    lam = np.clip(mesh.face_normals @ light, 0, 1) * 0.62 + 0.38
    facing = mesh.face_normals @ cam
    img = np.ones((H, W, 3))
    zbuf = np.full((H, W), -1e9)
    base = np.array([0.30, 0.48, 0.80])
    for fi, (i0, i1, i2) in enumerate(mesh.faces):
        if facing[fi] <= 0:
            continue
        xs = px[[i0, i1, i2]]; ys = py[[i0, i1, i2]]; zs = dz[[i0, i1, i2]]
        x0, x1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, W - 1)
        y0, y1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-12:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        z = l0 * zs[0] + l1 * zs[1] + l2 * zs[2]
        sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        upd = inside & (z > zbuf[sl])
        zbuf[sl] = np.where(upd, z, zbuf[sl])
        img[sl][upd] = base * lam[fi]
    return img.reshape(h, ss, w, ss, 3).mean(axis=(1, 3))


def preview(meshes, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, len(meshes), figsize=(5.4 * len(meshes), 4.4), facecolor='white')
    for ax, (title, m) in zip(axes, meshes):
        ax.imshow(render(m)); ax.set_axis_off(); ax.set_title(title, fontsize=12)
    fig.tight_layout(); fig.savefig(path, dpi=120)


def main():
    cats, modes, types, keys, accepts, cfg, asg = sp.design()
    geo = sp.Spokes(cfg)
    K = {name: frozenset(ks) for name, ks in
         (('K1', {'D1'}), ('K2', {'P1', 'D1'}), ('K3', {'N1', 'P1', 'V1.5'}))}
    for k in K.values():
        assert k in asg, f'key {sorted(k)} not in the kit'
    SOCK = [('DP', 'D1'), ('PP', 'P1'), ('NP', 'N1')]
    code = lambda name: asg[K[name]]

    # plugs: K1, K2, K3 (1, 2, 3 pits) and a spare K1
    plugs_mesh, plug_pos = plug_plate(geo, [(code('K1'), 1), (code('K2'), 2), (code('K3'), 3), (code('K1'), 1)])
    # clearance block: DP socket at five clearances (1..5 pits)
    dp_codes = [asg[k] for k in accepts['D1']]
    clr_mesh, clr_pos = socket_block(geo, [(dp_codes, c, i + 1) for i, c in enumerate(CLEARANCES)], cols=3)
    # key block: DP, PP, NP at the design clearance (1, 2, 3 pits)
    key_mesh, key_pos = socket_block(
        geo, [([asg[k] for k in accepts[t]], sp.CLR, i + 1) for i, (_, t) in enumerate(SOCK)], cols=3)

    parts = {'coupon_plugs': plugs_mesh, 'coupon_clearance_sockets': clr_mesh, 'coupon_key_sockets': key_mesh}
    report = {}
    for n, m in parts.items():
        m.export(os.path.join(OUT, n + '.stl'))
        report[n] = health(m)
        print(f'{n}: {report[n]}')
    bad = [n for n, h in report.items() if not (h['watertight'] and h['volume'])]
    if bad: sys.exit(f'mesh problems: {bad}')

    # --- 3D checks on the actual meshes --------------------------------------
    plug = {n: plug_solid(geo, code(n)) for n in K}
    TOL, MIN = 0.05, 1.0
    failures = []

    # (1) the matrix: every plug seated in every real socket
    matrix = {}
    for n in K:
        for (cx, cy), (sname, stype) in zip(key_pos, SOCK):
            v = overlap(seated(plug[n], cx, cy), key_mesh)
            should = K[n] in accepts[stype]
            matrix[(n, sname)] = (should, v)
            if (should and v > TOL) or (not should and v < MIN):
                failures.append(f'{n} in {sname}: expected {"fit" if should else "refuse"}, overlap {v:.2f} mm3')

    # (2) clearance series: K1 must seat in all five
    series = []
    for (cx, cy), c in zip(clr_pos, CLEARANCES):
        v = overlap(seated(plug['K1'], cx, cy), clr_mesh)
        series.append((c, v))
        if v > TOL: failures.append(f'K1 in DP @{c}: overlap {v:.2f} mm3')

    # (3) one way in: turn K1 and K2 by every other spoke position
    cx, cy = key_pos[0]
    turns = {}
    for n in ('K1', 'K2'):
        vs = [overlap(seated(plug[n], cx, cy, cfg.step * j), key_mesh) for j in range(1, cfg.n_slots)]
        turns[n] = min(vs)
        if min(vs) < MIN: failures.append(f'{n} turned fits at some other position (min overlap {min(vs):.2f})')

    print('\nseated-overlap matrix (mm3):')
    print('        ' + '  '.join(f'{s:>10}' for s, _ in SOCK))
    for n in K:
        print(f'  {n}   ' + '  '.join(f'{("fits  " if matrix[(n, s)][0] else "refuse")} {matrix[(n, s)][1]:5.1f}' for s, _ in SOCK))
    print('clearance series (K1 in DP):', ', '.join(f'{c}: {v:.2f}' for c, v in series))
    print('smallest overlap when turned to another spoke position:', {k: round(v, 1) for k, v in turns.items()})
    if failures:
        print('FAILURES:'); [print('  ', f) for f in failures]; sys.exit(1)

    preview([('coupon_plugs', plugs_mesh), ('coupon_clearance_sockets', clr_mesh),
             ('coupon_key_sockets', key_mesh)], os.path.join(OUT, 'preview.png'))
    write_doc(cfg, report, K, SOCK, accepts, matrix, key_pos)
    json.dump(dict(parts=report, dims=dict(plug_len=PLUG_LEN, block_h=BLOCK_H, core_diameter=2 * cfg.R,
                                           clearances=CLEARANCES, design_clearance=sp.CLR)),
              open(os.path.join(OUT, 'coupon.json'), 'w'), indent=1)
    print('all coupon checks passed')


def write_doc(cfg, report, K, SOCK, accepts, matrix, key_pos):
    sz = lambda n: ' x '.join(f'{x:g}' for x in report[n]['bounds'])
    L = ['# Test coupon\n',
         'Generated by `physical/coupon.py`. Three small prints that test the connectors on your own printer '
         'before the real set is made. The plugs and sockets are the kit\'s own (same keys, spoke angles and '
         f'{2 * cfg.R:.1f} mm core as `physical/out/spokes.png`).\n',
         '| File | What | Size (mm) |', '|---|---|---|',
         f'| `coupon_plugs.stl` | 4 plugs standing on a plate: K1, K2, K3 (1, 2, 3 pits) and a spare K1 | {sz("coupon_plugs")} |',
         f'| `coupon_clearance_sockets.stl` | 5 sockets, same key, clearance 0.05 to 0.25 mm (1 to 5 pits) | {sz("coupon_clearance_sockets")} |',
         f'| `coupon_key_sockets.stl` | the real DP, PP and NP sockets at {sp.CLR} mm (1, 2, 3 pits) | {sz("coupon_key_sockets")} |',
         '', '![preview](preview.png)\n',
         '## Printing\n',
         '- Print each part exactly as modelled: no supports, no rotation. Sockets open upwards; plugs stand tip-up.',
         '- PLA or PETG, 0.2 mm layers, 0.4 mm nozzle, 3 perimeters, about 20% infill. Slow down the outer walls if you can.',
         '- The sockets and plugs print with their axis vertical so the round core comes out as round as your printer can '
         'make it. That is the right orientation for a fit test, not necessarily for strength; that comes later.',
         '- Note which material, nozzle and layer height you used, because the right clearance depends on them.\n',
         '## Tests\n',
         '**1. Clearance.** Try plug K1 in each socket of the clearance block (pits = 0.05, 0.10, 0.15, 0.20, 0.25 mm). '
         'Write down for each: falls in / slides in with light pressure / needs force / will not go in.',
         '**2. Keys.** Try every plug in every socket of the key block, with the plug turned so the thick white '
         'spoke is at the top. Expected result (this is what the geometry says should happen):\n',
         '| Plug \\ socket | ' + ' | '.join(f'{s} ({t})' for s, t in SOCK) + ' |', '|---|' + '---|' * len(SOCK)]
    for n in K:
        L.append(f'| {n} (takes {" or ".join(sorted(K[n]))}) | ' +
                 ' | '.join('**goes in**' if matrix[(n, s)][0] else 'refuses' for s, _ in SOCK) + ' |')
    L += ['',
          'K2 is the interesting one: it is the right slot of a V′, which takes a DP **or** a PP, so it should go '
          'into both. K1 (a DP only) and K3 (an NP, a PP or a V′) should each refuse the sockets they do not take.\n',
          f'**3. One way in.** Turn K1 into the DP socket one spoke position at a time ({cfg.step:.0f} degrees). '
          'It should only go in when the thick spoke lines up with the thick groove.\n',
          '**4. Hold.** With the best-fitting clearance, push K1 into DP and hang a weight from the plate, or just lift the '
          'block by the plate. There is no snap bead yet, so this is friction only. Tell me whether it holds, '
          'and how much you would want it to hold.\n',
          '## What to send back\n',
          '- the material, nozzle and layer height; the clearance that felt right; the matrix as you saw it;',
          '- whether the spokes came out crisp or fused, and whether the thin tip chamfer printed.\n',
          '## What the script checked already\n',
          'On the exported meshes (not the 2D drawings), by seating each plug in each socket and measuring the overlap:\n',
          '| Plug \\ socket | ' + ' | '.join(s for s, _ in SOCK) + ' |', '|---|' + '---|' * len(SOCK)]
    for n in K:
        L.append(f'| {n} | ' + ' | '.join(f'{matrix[(n, s)][1]:.2f} mm³' + (' (fits)' if matrix[(n, s)][0] else ' (blocked)')
                                         for s, _ in SOCK) + ' |')
    L += ['', 'All three STL files are watertight solids. Turning a plug to any of the other spoke positions overlaps '
              'the socket in every case.']
    open(os.path.join(OUT, 'COUPON.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
