#!/usr/bin/env python3
"""
Derive and verify the connector keys for the physical set.

Model (see the design discussion):
  * One cylinder per node type. Female socket on top (what it can hang from),
    one male plug per child port underneath (what can hang from it).
  * A plug's key and a socket's key are independent. A plug fits a socket iff
    the socket is one of the child types that port is allowed to take.
  * Every plug/socket shares one round core (diameter + snap bead are purely
    mechanical). The KEY is ribs on the plug and matching grooves in the
    socket, in two axial zones: A (tip, deepest) and B (proximal).
    A plug carries one rib in each zone, so its code is (a, b).
    A socket cuts a groove for every (a) and (b) of the plugs it accepts.
    Plug fits iff a is in the socket's zone-A grooves AND b is in its zone-B
    grooves -- so the codes must be assigned so that no *unaccepted* plug
    happens to land inside that product. The search below does that.
  * A flat on one side of the core is the registration feature: without it a
    round plug can be spun into a different slot.

Everything is checked geometrically with shapely, not just by the code table.

Run from the repo root:  python3 physical/keys.py
"""
import itertools, json, math, os, random, sys
from shapely.geometry import box, Point
from shapely.affinity import rotate

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

# --- physical parameters (mm) ------------------------------------------------
R = 8.0            # core radius (16 mm cylinder)
FLAT = 1.2         # depth of the registration flat
RIB_W = 2.4        # rib width
RIB_H = 1.8        # rib height beyond the core
CLR = 0.15         # clearance per side (tune with the print coupon)
ARC = 300.0        # degrees of the circumference usable for ribs
FLAT_ANGLE = 0.0   # registration flat sits at this angle, ribs fill the rest

# --- the grammar, as child ports --------------------------------------------
# port name -> set of child types it may take. L/M/R = left/middle/right as
# the game lays them out; U = the only child. Cross-checked against the
# game's own legal-edge list below, so a typo here fails loudly.
PORTS = {
    'xbar': {
        'T1':   {'L': {'D1'},          'R': {'T1.5'}},
        'T1.5': {'L': {'T2'},          'R': {'V1'}},
        'V1':   {'U': {'V1.5'}},
        'V1.5': {'L': {'V1.5', 'V2'},  'R': {'P1', 'D1'}},
        'D1':   {'U': {'D1.5'}},
        'D1.5': {'L': {'D2'},          'R': {'N1'}},
        'N1':   {'U': {'N1.5'}},
        'N1.5': {'U': {'N2'}},
        'C1':   {'L': {'D1'},          'R': {'C1.5'}},
        'C1.5': {'L': {'C2'},          'R': {'T1'}},
        'P1':   {'U': {'P1.5'}},
        'P1.5': {'L': {'P2'},          'R': {'D1'}},
    },
    'prex': {
        'N1':   {'L': {'D2'},  'M': {'Adj1'}, 'R': {'N2'}},
        'Adj1': {'U': {'Adj2'}},
        'Adv1': {'U': {'Adv2'}},
        'V1':   {'L': {'Adv1'}, 'M': {'V2'},  'R': {'N1', 'P1'}},
        'P1':   {'L': {'P2'},  'R': {'N1'}},
        'T1':   {'L': {'N1'},  'M': {'T2'},   'R': {'V1'}},
    },
}
MODE_NAMES = {'xbar': 'X / X-bar / XP set', 'prex': 'X / XP (flat) set'}


def load_rules():
    with open(os.path.join(HERE, 'rules.json')) as f:
        raw = json.load(f)
    return {m: {tuple(e) for e in edges} for m, edges in raw.items()}


def check_against_game(mode, legal):
    from_ports = {(p, c) for p, ports in PORTS[mode].items()
                  for kids in ports.values() for c in kids}
    missing, extra = legal - from_ports, from_ports - legal
    if missing or extra:
        sys.exit(f'[{mode}] port table disagrees with data.js: '
                 f'missing={sorted(missing)} extra={sorted(extra)}')


def key_name(kids):
    return '->' + '|'.join(sorted(kids))


# --- key assignment ----------------------------------------------------------
def assign_codes(keys, accepts, n_a, n_b, seed=0):
    """keys: list of frozenset(child types). accepts[child] = set of keys that
    child's socket takes. Returns {key: (a, b)} with the product property."""
    rng = random.Random(seed)
    codes_all = list(itertools.product(range(n_a), range(n_b)))
    for _ in range(20000):
        rng.shuffle(codes_all)
        asg = dict(zip(keys, codes_all[:len(keys)]))
        if valid(asg, accepts):
            return asg
    raise RuntimeError('no valid code assignment found')


def valid(asg, accepts):
    for child, ks in accepts.items():
        sa = {asg[k][0] for k in ks}
        sb = {asg[k][1] for k in ks}
        for p, (a, b) in asg.items():
            if p not in ks and a in sa and b in sb:
                return False
    return True


# --- geometry ---------------------------------------------------------------
def slot_angles(n):
    """n evenly spaced rib angles on the arc opposite the registration flat."""
    start = FLAT_ANGLE + (360 - ARC) / 2
    step = ARC / (n - 1) if n > 1 else 0
    return [start + i * step for i in range(n)]


def rib(theta, width, r0, r1):
    return rotate(box(r0, -width / 2, r1, width / 2), theta, origin=(0, 0))


def core(radius, flat_depth):
    c = Point(0, 0).buffer(radius, 64)
    # flat on the +x side (angle FLAT_ANGLE == 0)
    return c.intersection(box(-radius - 1, -radius - 1, radius - flat_depth, radius + 1))


class Geometry:
    def __init__(self, n_a, n_b, with_flat=True):
        n = n_a + n_b
        angles = slot_angles(n)
        # alternate A,B,A,B... so each zone's ribs are spread around the circle
        self.ang_a, self.ang_b = [], []
        for i, th in enumerate(angles):
            (self.ang_a if i % 2 == 0 else self.ang_b).append(th)
        assert len(self.ang_a) == n_a and len(self.ang_b) == n_b, 'pick n_a == n_b or n_a == n_b+1'
        # The socket's flat is shallower by CLR so the plug's flat clears it.
        self.plug_core = core(R, FLAT if with_flat else 0.0)
        self.sock_core = core(R + CLR, FLAT - CLR if with_flat else 0.0)

    def plug(self, code):
        a, b = code
        r0, r1 = R - 0.6, R + RIB_H
        ra = rib(self.ang_a[a], RIB_W, r0, r1)
        rb = rib(self.ang_b[b], RIB_W, r0, r1)
        tip = self.plug_core.union(ra)                 # zone A cross-section
        prox = self.plug_core.union(ra).union(rb)      # zone B: tip rib sweeps through
        return tip, prox

    def socket(self, codes):
        r0, r1 = R - 0.6, R + RIB_H + CLR
        w = RIB_W + 2 * CLR
        sa = {c[0] for c in codes}
        sb = {c[1] for c in codes}
        deep = self.sock_core
        for a in sa:
            deep = deep.union(rib(self.ang_a[a], w, r0, r1))
        shallow = deep
        for b in sb:
            shallow = shallow.union(rib(self.ang_b[b], w, r0, r1))
        return deep, shallow


def fits(plug_zones, sock_zones, rot=0.0):
    (tip, prox), (deep, shallow) = plug_zones, sock_zones
    if rot:
        tip, prox = rotate(tip, rot, origin=(0, 0)), rotate(prox, rot, origin=(0, 0))
    eps = 1e-6
    return deep.buffer(eps).contains(tip) and shallow.buffer(eps).contains(prox)


# --- per-mode pipeline ------------------------------------------------------
def build(mode, legal):
    check_against_game(mode, legal)
    ports = PORTS[mode]
    types = sorted({t for p, k in legal for t in (p, k)},
                   key=lambda t: (not t.endswith('1'), t))
    # every port is a physical plug; plugs with identical accepted-child sets
    # can share a key.
    plug_ports = [(p, name, frozenset(kids))
                  for p, pp in ports.items() for name, kids in pp.items()]
    keys = sorted({k for _, _, k in plug_ports}, key=lambda k: sorted(k))
    accepts = {c: {k for k in keys if c in k} for c in types}

    # smallest grid (n_a == n_b or n_b + 1) with room for every key
    n_a, n_b = next((na, nb) for nb in range(2, 9) for na in (nb, nb + 1)
                    if na * nb >= len(keys))

    asg = assign_codes(keys, accepts, n_a, n_b)
    geo = Geometry(n_a, n_b, with_flat=True)
    geo_noflat = Geometry(n_a, n_b, with_flat=False)

    plugs = {k: geo.plug(asg[k]) for k in keys}
    socks = {c: geo.socket([asg[k] for k in accepts[c]]) for c in types if accepts[c]}

    # 1) every plug x socket pair at the correct orientation
    wrong, missed, tested = [], [], 0
    for k in keys:
        for c, z in socks.items():
            tested += 1
            f = fits(plugs[k], z)
            should = c in k
            if f and not should: wrong.append((key_name(k), c))
            if should and not f: missed.append((key_name(k), c))

    # 2) registration: with the flat, no plug may seat at any other rotation
    spun = 0
    for k in keys:
        for c, z in socks.items():
            for rot in range(10, 360, 10):
                if fits(plugs[k], z, rot):
                    spun += 1
    # counterfactual: no flat -> how many wrong spins would exist?
    nf_plugs = {k: geo_noflat.plug(asg[k]) for k in keys}
    nf_socks = {c: geo_noflat.socket([asg[k] for k in accepts[c]]) for c in types if accepts[c]}
    spun_noflat = 0
    for k in keys:
        for c, z in nf_socks.items():
            if c in k:
                continue
            for rot in range(10, 360, 10):
                if fits(nf_plugs[k], z, rot):
                    spun_noflat += 1

    return dict(mode=mode, types=types, ports=ports, plug_ports=plug_ports, keys=keys,
                accepts=accepts, n_a=n_a, n_b=n_b, asg=asg, tested=tested,
                wrong=wrong, missed=missed, spun=spun, spun_noflat=spun_noflat,
                geo=geo, plugs=plugs, socks=socks)


# --- output ------------------------------------------------------------------
def poly_path(g, s, ox, oy):
    geoms = list(g.geoms) if hasattr(g, 'geoms') else [g]
    d = ''
    for p in geoms:
        for ring in [p.exterior, *p.interiors]:
            pts = [(ox + x * s, oy - y * s) for x, y in ring.coords]
            d += 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in pts) + ' Z '
    return d


def write_svg(res, path):
    s, cell = 5.0, 120
    items = []
    for k in res['keys']:
        a, b = res['asg'][k]
        items.append(('plug', key_name(k) + f'  ({a},{b})', res['plugs'][k][1]))
    for c in res['types']:
        if c in res['socks']:
            items.append(('sock', 'socket ' + c, res['socks'][c][1]))
    cols = 6
    rows = math.ceil(len(items) / cols)
    W, H = cols * cell, rows * (cell + 18) + 10
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}" font-family="sans-serif" font-size="9">',
           '<rect width="100%" height="100%" fill="white"/>']
    for i, (kind, label, g) in enumerate(items):
        cx = (i % cols) * cell + cell / 2
        cy = (i // cols) * (cell + 18) + cell / 2 + 4
        fill = '#3f8fd0' if kind == 'plug' else '#d84a3b'
        svg.append(f'<path d="{poly_path(g, s, cx, cy)}" fill="{fill}" fill-opacity=".85" '
                   f'stroke="#222" stroke-width=".6" fill-rule="evenodd"/>')
        svg.append(f'<text x="{cx}" y="{cy + cell/2 + 6}" text-anchor="middle">{label}</text>')
    svg.append('</svg>')
    with open(path, 'w') as f:
        f.write('\n'.join(svg))


def write_report(results, path):
    L = []
    L.append('# Connector keys, derived from the game\'s rules\n')
    L.append('Generated by `physical/keys.py` from `data.js` (via `physical/dump_rules.js`). '
             'Do not edit by hand -- change the script or the game data and re-run.\n')
    for res in results:
        m = res['mode']
        L.append(f'\n## {MODE_NAMES[m]}\n')
        max_arms = max(len(p) for p in res['ports'].values())
        L.append(f'- **{len(res["types"])} piece designs**, **{len(res["keys"])} distinct plug keys**, '
                 f'up to **{max_arms} arms** on one piece.')
        L.append(f'- Key code: one rib in zone A ({res["n_a"]} positions) and one in zone B '
                 f'({res["n_b"]} positions) = {res["n_a"] * res["n_b"]} possible codes, '
                 f'{len(res["keys"])} used.')
        L.append(f'- **Wrong-pair test:** {res["tested"]} plug x socket pairs checked geometrically. '
                 f'Wrongly fitting: **{len(res["wrong"])}**. Correct pairs that fail to fit: **{len(res["missed"])}**.')
        L.append(f'- **Registration flat:** with it, plugs that seat at any rotation other than 0 degrees: '
                 f'**{res["spun"]}**. Without it (counterfactual), wrong pairs that could be forced in '
                 f'by spinning the plug: **{res["spun_noflat"]}**.\n')
        if res['wrong']:
            L.append('  WRONG FITS: ' + ', '.join(f'{a} into {b}' for a, b in res['wrong']) + '\n')
        L.append('### Pieces\n')
        L.append('| Piece | Hangs from (socket accepts) | Arms, left to right (plug fits these children) |')
        L.append('|---|---|---|')
        for t in res['types']:
            acc = res['accepts'][t]
            frm = ', '.join(sorted(f'{p}.{n}' for p, n, k in res['plug_ports'] if k in acc)) or '(root only)'
            arms = res['ports'].get(t, {})
            order = {'L': 0, 'M': 1, 'R': 2, 'U': 1}
            arm_txt = '; '.join(
                f'{n}: {{{", ".join(sorted(kids))}}} code {res["asg"][frozenset(kids)]}'
                for n, kids in sorted(arms.items(), key=lambda kv: order[kv[0]])) or '(head: no arms)'
            L.append(f'| {t} | {frm} | {arm_txt} |')
        L.append('')
        L.append('### Keys\n')
        L.append('| Plug key (fits these child types) | Code (zone A, zone B) | Used by |')
        L.append('|---|---|---|')
        for k in res['keys']:
            users = ', '.join(sorted(f'{p}.{n}' for p, n, kk in res['plug_ports'] if kk == k))
            L.append(f'| {key_name(k)} | {res["asg"][k]} | {users} |')
        L.append(f'\nProfiles: `physical/out/profiles_{m}.svg` '
                 '(blue = plug cross-section at the proximal zone, red = socket cross-section at the entrance zone).')
    with open(path, 'w') as f:
        f.write('\n'.join(L) + '\n')


def main():
    legal = load_rules()
    results = []
    for mode in ('prex', 'xbar'):
        res = build(mode, legal[mode])
        results.append(res)
        write_svg(res, os.path.join(OUT, f'profiles_{mode}.svg'))
        with open(os.path.join(OUT, f'keys_{mode}.json'), 'w') as f:
            json.dump({
                'params': dict(R=R, FLAT=FLAT, RIB_W=RIB_W, RIB_H=RIB_H, CLR=CLR, ARC=ARC),
                'angles_a': res['geo'].ang_a, 'angles_b': res['geo'].ang_b,
                'keys': {key_name(k): dict(code=res['asg'][k], fits=sorted(k)) for k in res['keys']},
                'sockets': {c: sorted(key_name(k) for k in res['accepts'][c]) for c in res['types']},
                'arms': {p: {n: sorted(k) for n, k in pp.items()} for p, pp in res['ports'].items()},
            }, f, indent=1)
        print(f'[{mode}] types={len(res["types"])} keys={len(res["keys"])} '
              f'grid={res["n_a"]}x{res["n_b"]} tested={res["tested"]} '
              f'wrong={len(res["wrong"])} missed={len(res["missed"])} '
              f'spun={res["spun"]} spun_noflat={res["spun_noflat"]}')
    write_report(results, os.path.join(HERE, 'KEYS.md'))
    if any(r['wrong'] or r['missed'] or r['spun'] for r in results):
        sys.exit('VERIFICATION FAILED')
    print('all checks passed')


if __name__ == '__main__':
    main()
