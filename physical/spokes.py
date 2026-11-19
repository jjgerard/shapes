#!/usr/bin/env python3
"""
Circle-and-spokes connectors for the physical set.

  * One piece per node type (XP, X', X0 of each category). Female socket on
    top, one male plug per child slot underneath.
  * A slot accepts EVERY child type the game allows in that position (a V'
    right slot takes a DP or a PP; its left slot a V' or a V head).
  * Every socket and plug is a round core with spokes. Ten spoke positions
    are spaced evenly, 36 degrees apart:
        1 position  -> the orientation spoke: thicker than the rest, always
                       present, so a plug has exactly one way in
        9 positions -> the code, alternating zone A (deep, tip of the plug)
                       and zone B (shallow, near its base)
    A plug carries one spoke in zone A and one in zone B. A socket cuts a
    groove for every spoke of every plug it accepts. A plug fits a socket
    iff both its spokes find a groove, so the codes are chosen (by search)
    so that no plug that should NOT fit lands inside a socket's grooves.
  * Everything is then checked geometrically: every plug against every
    socket at every 3 degrees of rotation.

Run from the repo root:  node physical/dump_rules.js && python3 physical/spokes.py
"""
import itertools, json, math, os, random, sys
from shapely.geometry import Point, LineString
from shapely.affinity import rotate

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

# --- physical parameters (mm) ------------------------------------------------
R = 8.0                # core radius (16 mm cylinder)
SPOKE_W = 2.4          # code spoke width
REG_W = 4.2            # orientation spoke width (thicker, so it reads at a glance)
SPOKE_H = 2.0          # how far a spoke stands out of the core
CLR = 0.15             # clearance per side (tune with the print coupon)
N_SLOTS = 10           # evenly spaced spoke positions
STEP = 360 / N_SLOTS
REG_ANGLE = -90.0      # orientation spoke points "up"
GRID = (5, 4)          # zone A positions x zone B positions = 20 codes

# --- the grammar: child slots, each taking every shape allowed there --------
# slot name -> set of child types it takes. L/M/R follow the game's left to
# right layout; U = the only child. Checked against the game's legal edges.
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
LEVEL_SYMBOL = {'xbar': {1: 'P', 1.5: '′', 2: '⁰'}, 'prex': {1: 'P', 2: '⁰'}}
SLOT_ORDER = {'L': 0, 'M': 1, 'U': 1, 'R': 2}


# --- helpers -----------------------------------------------------------------
def split_type(t):
    shape = t.rstrip('0123456789.')
    n = float(t[len(shape):])
    return shape, int(n) if n == int(n) else n


def label(t, mode):
    s, n = split_type(t)
    return s + LEVEL_SYMBOL[mode][n]


def load():
    with open(os.path.join(HERE, 'rules.json')) as f:
        raw = json.load(f)
    return raw['categories'], raw['modes']


def check_against_game(mode_id, edges):
    legal = {tuple(e) for e in edges}
    mine = {(p, c) for p, ports in PORTS[mode_id].items()
            for kids in ports.values() for c in kids}
    if legal != mine:
        sys.exit(f'[{mode_id}] port table disagrees with data.js: '
                 f'missing={sorted(legal - mine)} extra={sorted(mine - legal)}')


def key_name(kids):
    return '->' + '|'.join(sorted(kids))


# --- code assignment ---------------------------------------------------------
def valid(asg, accepts):
    for ks in accepts.values():
        if not ks:
            continue
        sa = {asg[k][0] for k in ks}
        sb = {asg[k][1] for k in ks}
        for p, (a, b) in asg.items():
            if p not in ks and a in sa and b in sb:
                return False
    return True


def assign_codes(keys, accepts, seed=0):
    rng = random.Random(seed)
    codes = list(itertools.product(range(GRID[0]), range(GRID[1])))
    for _ in range(50000):
        rng.shuffle(codes)
        asg = dict(zip(keys, codes[:len(keys)]))
        if valid(asg, accepts):
            return asg
    raise RuntimeError('no valid assignment found')


# --- geometry ----------------------------------------------------------------
def spoke(theta, width, r0, r1):
    """A rounded-end spoke along angle theta."""
    s = LineString([(r0, 0), (r1 - width / 2, 0)]).buffer(width / 2, 12)
    return rotate(s, theta, origin=(0, 0))


class Spokes:
    def __init__(self, with_reg=True):
        angles = [REG_ANGLE + STEP * i for i in range(N_SLOTS)]
        self.reg = angles[0]
        self.ang_a = angles[1::2]       # 5 positions: 36, 108, 180, 252, 324 from the top
        self.ang_b = angles[2::2]       # 4 positions in between
        self.with_reg = with_reg
        assert (len(self.ang_a), len(self.ang_b)) == GRID
        self.r0, self.r1 = R - 0.8, R + SPOKE_H

    def parts(self, code):
        a, b = code
        return dict(core=Point(0, 0).buffer(R, 96),
                    a=spoke(self.ang_a[a], SPOKE_W, self.r0, self.r1),
                    b=spoke(self.ang_b[b], SPOKE_W, self.r0, self.r1),
                    reg=spoke(self.reg, REG_W, self.r0, self.r1))

    def plug(self, code):
        p = self.parts(code)
        tip = p['core'].union(p['a'])
        if self.with_reg:
            tip = tip.union(p['reg'])
        return tip, tip.union(p['b'])          # zone A section, zone B section

    def socket(self, codes):
        w, r1 = SPOKE_W + 2 * CLR, self.r1 + CLR
        deep = Point(0, 0).buffer(R + CLR, 96)
        if self.with_reg:
            deep = deep.union(spoke(self.reg, REG_W + 2 * CLR, self.r0, r1))
        for a in {c[0] for c in codes}:
            deep = deep.union(spoke(self.ang_a[a], w, self.r0, r1))
        shallow = deep
        for b in {c[1] for c in codes}:
            shallow = shallow.union(spoke(self.ang_b[b], w, self.r0, r1))
        return deep, shallow


def fits(plug, sock, rot=0.0):
    tip, prox = plug
    deep, shallow = sock
    if rot:
        tip, prox = rotate(tip, rot, origin=(0, 0)), rotate(prox, rot, origin=(0, 0))
    eps = 1e-6
    return deep.buffer(eps).contains(tip) and shallow.buffer(eps).contains(prox)


# --- per-mode pipeline -------------------------------------------------------
def build(mode_id, edges):
    check_against_game(mode_id, edges)
    ports = PORTS[mode_id]
    types = sorted({t for p, c in edges for t in (p, c)},
                   key=lambda t: (split_type(t)[1] != 1, split_type(t)[1], t))
    plug_slots = [(p, name, frozenset(kids)) for p, pp in ports.items() for name, kids in pp.items()]
    keys = sorted({k for _, _, k in plug_slots}, key=sorted)
    accepts = {c: {k for k in keys if c in k} for c in types}
    asg = assign_codes(keys, accepts)

    geo, geo_noreg = Spokes(True), Spokes(False)
    plugs = {k: geo.plug(asg[k]) for k in keys}
    socks = {c: geo.socket([asg[k] for k in accepts[c]]) for c in types if accepts[c]}

    wrong, missed = [], []
    for k in keys:
        for c, z in socks.items():
            f = fits(plugs[k], z)
            if f and c not in k: wrong.append((key_name(k), c))
            if c in k and not f: missed.append((key_name(k), c))
    spun = sum(fits(plugs[k], z, rot)
               for k in keys for z in socks.values() for rot in range(3, 360, 3))

    nr_plugs = {k: geo_noreg.plug(asg[k]) for k in keys}
    nr_socks = {c: geo_noreg.socket([asg[k] for k in accepts[c]]) for c in types if accepts[c]}
    spun_noreg = sum(fits(nr_plugs[k], z, rot)
                     for k in keys for z in nr_socks.values() for rot in range(3, 360, 3))

    # does the checker actually notice a bad assignment?
    rng, caught, tried = random.Random(1), 0, 0
    codes = list(itertools.product(range(GRID[0]), range(GRID[1])))
    for _ in range(60):
        rng.shuffle(codes)
        bad = dict(zip(keys, codes[:len(keys)]))
        if valid(bad, accepts):
            continue
        tried += 1
        bp = {k: geo.plug(bad[k]) for k in keys}
        bs = {c: geo.socket([bad[k] for k in accepts[c]]) for c in types if accepts[c]}
        caught += any(fits(bp[k], z) and c not in k for k in keys for c, z in bs.items())

    return dict(mode=mode_id, types=types, ports=ports, plug_slots=plug_slots, keys=keys,
                accepts=accepts, asg=asg, geo=geo, wrong=wrong, missed=missed,
                spun=spun, spun_noreg=spun_noreg, pairs=len(keys) * len(socks),
                selftest=(caught, tried))


# --- drawing -----------------------------------------------------------------
def shade(hexcol, f):
    """f > 0 lightens towards white, f < 0 darkens towards black."""
    r, g, b = (int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
    t = 255 if f > 0 else 0
    return '#%02x%02x%02x' % tuple(round(c + (t - c) * abs(f)) for c in (r, g, b))


def gpath(g, s, ox, oy):
    out = ''
    for p in (list(g.geoms) if hasattr(g, 'geoms') else [g]):
        for ring in [p.exterior, *p.interiors]:
            out += 'M' + ' L'.join(f'{ox + x * s:.2f},{oy + y * s:.2f}' for x, y in ring.coords) + 'Z '
    return out


def heart_pts():
    segs = [((16, 29.3), (16, 29.3), (2, 18), (2, 10.5)), ((2, 10.5), (2, 5.8), (5.6, 2), (10, 2)),
            ((10, 2), (12.6, 2), (15, 3.4), (16, 5.6)), ((16, 5.6), (17, 3.4), (19.4, 2), (22, 2)),
            ((22, 2), (26.4, 2), (30, 5.8), (30, 10.5)), ((30, 10.5), (30, 18), (16, 29.3), (16, 29.3))]
    pts = []
    for p0, p1, p2, p3 in segs:
        for i in range(24):
            t, u = i / 24, 1 - i / 24
            pts.append(((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0] - 16) / 15.3,
                        (u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1] - 15) / 15.3))
    return pts


def icon(shape, color, cx, cy, r, text):
    """The game's own node: its silhouette, colour and level number."""
    def ngon(n, rad, oy=0):
        return [(rad * math.cos(math.radians(-90 + 360 / n * i)), oy + rad * math.sin(math.radians(-90 + 360 / n * i)))
                for i in range(n)]
    st = f'fill="{color}" stroke="{shade(color, -.35)}" stroke-width="1" stroke-linejoin="round"'
    if shape == 'circle':
        el = f'<circle cx="{cx}" cy="{cy}" r="{r}" {st}/>'
    elif shape == 'square':
        el = f'<rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" rx="{r * .12}" {st}/>'
    elif shape == 'rectangle':
        el = f'<rect x="{cx - r * 1.35}" y="{cy - r * .78}" width="{2.7 * r}" height="{1.56 * r}" rx="{r * .12}" {st}/>'
    else:
        pts = {'triangle': ngon(3, r * 1.15, r * .08), 'pentagon': ngon(5, r * 1.12, r * .06),
               'diamond': ngon(4, r * 1.2),
               'star': [((r * 1.15 if i % 2 == 0 else r * .5) * math.cos(math.radians(-90 + 36 * i)),
                         (r * 1.15 if i % 2 == 0 else r * .5) * math.sin(math.radians(-90 + 36 * i))) for i in range(10)],
               'heart': [(x * r, y * r) for x, y in heart_pts()]}[shape]
        el = f'<polygon points="{" ".join(f"{cx + x:.1f},{cy + y:.1f}" for x, y in pts)}" {st}/>'
    fs = r * {'star': .62, 'triangle': .8, 'heart': .88, 'pentagon': .92}.get(shape, 1.0) * (0.8 if len(text) > 2 else 1.0)
    return el + (f'<text x="{cx}" y="{cy + fs * .36}" text-anchor="middle" font-size="{fs:.1f}" '
                 f'font-weight="700" fill="#fff" font-family="Helvetica,Arial,sans-serif">{text}</text>')


def draw_plug(res, geo, code, color, cx, cy, s):
    p = geo.parts(code)
    return (f'<path d="{gpath(p["core"], s, cx, cy)}" fill="{shade(color, .25)}" stroke="{shade(color, -.4)}" stroke-width="1"/>'
            f'<path d="{gpath(p["b"], s, cx, cy)}" fill="{shade(color, .55)}" stroke="{shade(color, -.4)}" stroke-width="1"/>'
            f'<path d="{gpath(p["a"], s, cx, cy)}" fill="{shade(color, -.3)}" stroke="{shade(color, -.6)}" stroke-width="1"/>'
            f'<path d="{gpath(p["reg"], s, cx, cy)}" fill="#fff" stroke="{shade(color, -.5)}" stroke-width="1.2"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{s * 1.1:.1f}" fill="{shade(color, -.35)}" opacity=".55"/>')


def draw_socket(res, geo, codes, color, cx, cy, s):
    deep, shallow = geo.socket(codes)
    outer = Point(0, 0).buffer(R + SPOKE_H + 2.6, 96)
    return (f'<path d="{gpath(outer, s, cx, cy)}" fill="{color}" stroke="{shade(color, -.4)}" stroke-width="1.2"/>'
            f'<path d="{gpath(outer.buffer(-0.7), s, cx, cy)}" fill="none" stroke="{shade(color, .45)}" stroke-width="1"/>'
            f'<path d="{gpath(shallow, s, cx, cy)}" fill="#fff" stroke="{shade(color, -.5)}" stroke-width="1.2"/>'
            f'<path d="{gpath(deep, s, cx, cy)}" fill="#d9dde3" stroke="none"/>'
            f'<path d="{gpath(shallow, s, cx, cy)}" fill="none" stroke="{shade(color, -.5)}" stroke-width="1.2"/>')


def piece_sheet(res, cats, path):
    mode = res['mode']
    geo, s = res['geo'], 3.6
    max_arms = max(len(p) for p in res['ports'].values())
    cell_w, cell_h = 118 * (1 + max_arms) + 20, 214
    cols = 3 if max_arms <= 2 else 2
    types = res['types']
    rows = math.ceil(len(types) / cols)
    top = 210
    W, H = cols * cell_w + 40, top + rows * cell_h + 20
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'font-family="Helvetica,Arial,sans-serif">',
           '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
           '<stop offset="0" stop-color="#f7f8fb"/><stop offset="1" stop-color="#eef0f5"/></linearGradient></defs>',
           f'<rect width="{W}" height="{H}" fill="url(#bg)"/>',
           f'<text x="24" y="40" font-size="24" font-weight="700" fill="#222">{MODE_NAMES[mode]}</text>',
           f'<text x="24" y="62" font-size="13" fill="#555">{len(types)} pieces · each socket on top takes the plugs shown on '
           f'the arms above it · every slot takes all the shapes the game allows there</text>']
    # key to the ring, drawn at the same scale as the pieces
    kx, ky = 24 + 70, 144
    ring = Point(0, 0).buffer(R + SPOKE_H + 2.6, 96)
    svg.append(f'<path d="{gpath(ring, 3.0, kx, ky)}" fill="#fff" stroke="#bbb"/>')
    svg.append(f'<path d="{gpath(Point(0, 0).buffer(R, 96), 3.0, kx, ky)}" fill="#e6e9ef" stroke="#999"/>')
    angles = [REG_ANGLE + STEP * i for i in range(N_SLOTS)]
    for i, th in enumerate(angles):
        w = REG_W if i == 0 else SPOKE_W
        col = '#ffffff' if i == 0 else ('#4a5a78' if i % 2 else '#9fb0cf')
        svg.append(f'<path d="{gpath(spoke(th, w, R - 0.8, R + SPOKE_H), 3.0, kx, ky)}" fill="{col}" stroke="#667" stroke-width="1"/>')
    for i, th in enumerate(angles):
        tx = kx + math.cos(math.radians(th)) * 3.0 * (R + SPOKE_H + 5.2)
        ty = ky + math.sin(math.radians(th)) * 3.0 * (R + SPOKE_H + 5.2)
        name = 'up' if i == 0 else (f'A{(i - 1) // 2 + 1}' if i % 2 else f'B{(i - 2) // 2 + 1}')
        svg.append(f'<text x="{tx:.1f}" y="{ty + 4:.1f}" text-anchor="middle" font-size="11" fill="#556">{name}</text>')
    lx = kx + 130
    for j, (txt, col) in enumerate([('white spoke: orientation key, one way in', '#ffffff'),
                                    ('dark spokes (A): the plug tip, deepest in the socket', '#4a5a78'),
                                    ('pale spokes (B): near the base of the plug', '#9fb0cf'),
                                    ('ten positions, evenly spaced every 36°', None)]):
        y = 112 + j * 22
        if col:
            svg.append(f'<rect x="{lx}" y="{y - 11}" width="22" height="13" rx="3" fill="{col}" stroke="#667"/>')
        svg.append(f'<text x="{lx + 32}" y="{y}" font-size="13" fill="#333">{txt}</text>')

    for i, t in enumerate(types):
        ox = 20 + (i % cols) * cell_w
        oy = top + (i // cols) * cell_h
        shape, n = split_type(t)
        color = cats[shape]['color']
        svg.append(f'<rect x="{ox + 6}" y="{oy + 4}" width="{cell_w - 12}" height="{cell_h - 12}" rx="14" '
                   f'fill="#fff" stroke="#dde1ea"/>')
        svg.append(icon(cats[shape]['shape'], color, ox + 38, oy + 36, 17, str(n)))
        svg.append(f'<text x="{ox + 66}" y="{oy + 32}" font-size="18" font-weight="700" fill="#222">{label(t, mode)}</text>')
        svg.append(f'<text x="{ox + 66}" y="{oy + 49}" font-size="11" fill="#667">{cats[shape]["name"]}</text>')
        py = oy + 125
        # top socket: what this piece can hang from
        svg.append(draw_socket(res, geo, [res['asg'][k] for k in res['accepts'][t]], color, ox + 62, py, s))
        parents = sorted({f'{label(p, mode)}.{nm}' for p, nm, k in res['plug_slots'] if k in res['accepts'][t]})
        svg.append(f'<text x="{ox + 62}" y="{oy + 188}" text-anchor="middle" font-size="10" fill="#667">top socket</text>')
        svg.append(f'<text x="{ox + 62}" y="{oy + 200}" text-anchor="middle" font-size="9" fill="#889">'
                   f'{", ".join(parents)[:30] or "root"}</text>')
        arms = sorted(res['ports'].get(t, {}).items(), key=lambda kv: SLOT_ORDER[kv[0]])
        for j, (nm, kids) in enumerate(arms):
            ax = ox + 62 + 118 * (j + 1)
            svg.append(f'<path d="M{ax - 44},{py} L{ax - 118 + 44 + 2},{py}" stroke="#c9cfdb" stroke-width="2" '
                       f'stroke-dasharray="3 4"/>')
        for j, (nm, kids) in enumerate(arms):
            ax = ox + 62 + 118 * (j + 1)
            svg.append(draw_plug(res, geo, res['asg'][frozenset(kids)], color, ax, py, s))
            takes = ' · '.join(label(k, mode) for k in sorted(kids))
            svg.append(f'<text x="{ax}" y="{oy + 188}" text-anchor="middle" font-size="10" fill="#667">'
                       f'{ {"L": "left", "M": "middle", "R": "right", "U": "slot"}[nm] } arm</text>')
            svg.append(f'<text x="{ax}" y="{oy + 200}" text-anchor="middle" font-size="11" font-weight="700" '
                       f'fill="{shade(color, -.35)}">takes {takes}</text>')
        if not arms:
            svg.append(f'<text x="{ox + 62 + 118}" y="{py + 4}" font-size="12" fill="#99a" >head: no arms — carries a word</text>')
    svg.append('</svg>')
    open(path, 'w').write('\n'.join(svg))


def write_report(results, path):
    L = ['# Circle-and-spokes connectors, derived from the game\n',
         'Generated by `physical/spokes.py` from `data.js` (via `physical/dump_rules.js`). Do not edit by hand.\n',
         f'Ten spoke positions are spaced evenly every {STEP:.0f} degrees around a {2 * R:.0f} mm core: one thicker '
         f'orientation spoke at the top and nine code spokes (five in the deep zone A, four in the shallow zone B). '
         f'Spoke width {SPOKE_W} mm (orientation spoke {REG_W} mm), {SPOKE_H} mm tall, clearance {CLR} mm per side.\n']
    for res in results:
        m = res['mode']
        ma = max(len(p) for p in res['ports'].values())
        c, t = res['selftest']
        L += [f'\n## {MODE_NAMES[m]}\n',
              f'- **{len(res["types"])} piece designs**, **{len(res["keys"])} distinct plug keys** of {GRID[0] * GRID[1]} '
              f'possible, up to **{ma} arms** on one piece.',
              f'- **Wrong-pair test:** {res["pairs"]} plug x socket pairs checked geometrically: wrongly fitting '
              f'**{len(res["wrong"])}**, correct pairs that fail **{len(res["missed"])}**.',
              f'- **Orientation:** every plug at every 3 degrees of rotation against every socket: seats at a wrong '
              f'rotation **{res["spun"]}** times. Without the thick orientation spoke it would be {res["spun_noreg"]}.',
              f'- **Self-check:** the geometry test flagged wrong fits in {c} of {t} deliberately invalid code assignments.\n',
              '| Piece | Hangs from | Arms, left to right (each takes ALL of these) |', '|---|---|---|']
        for tp in res['types']:
            frm = ', '.join(sorted(f'{label(p, m)}.{n}' for p, n, k in res['plug_slots'] if k in res['accepts'][tp])) or '(root only)'
            arms = '; '.join(f'{n}: {" or ".join(label(k, m) for k in sorted(kids))}  [code {res["asg"][frozenset(kids)]}]'
                             for n, kids in sorted(res['ports'].get(tp, {}).items(), key=lambda kv: SLOT_ORDER[kv[0]])) or '(head, no arms)'
            L.append(f'| {label(tp, m)} | {frm} | {arms} |')
        L.append(f'\nDrawing: `physical/out/spokes_{m}.svg` (and `.png`).')
    open(path, 'w').write('\n'.join(L) + '\n')


def main():
    cats, modes = load()
    results = []
    for mid in ('prex', 'xbar'):
        res = build(mid, modes[mid]['edges'])
        results.append(res)
        piece_sheet(res, cats, os.path.join(OUT, f'spokes_{mid}.svg'))
        json.dump(dict(
            params=dict(R=R, SPOKE_W=SPOKE_W, REG_W=REG_W, SPOKE_H=SPOKE_H, CLR=CLR, N_SLOTS=N_SLOTS, GRID=GRID),
            angles=dict(reg=res['geo'].reg, A=res['geo'].ang_a, B=res['geo'].ang_b),
            keys={key_name(k): dict(code=res['asg'][k], takes=sorted(k)) for k in res['keys']},
            sockets={c: sorted(key_name(k) for k in res['accepts'][c]) for c in res['types']},
            arms={p: {n: sorted(k) for n, k in pp.items()} for p, pp in res['ports'].items()},
        ), open(os.path.join(OUT, f'spokes_{mid}.json'), 'w'), indent=1)
        c, t = res['selftest']
        print(f'[{mid}] pieces={len(res["types"])} keys={len(res["keys"])} pairs={res["pairs"]} '
              f'wrong={len(res["wrong"])} missed={len(res["missed"])} spun={res["spun"]} '
              f'(no orientation spoke: {res["spun_noreg"]}) selftest={c}/{t}')
    write_report(results, os.path.join(HERE, 'SPOKES.md'))
    if any(r['wrong'] or r['missed'] or r['spun'] for r in results):
        sys.exit('VERIFICATION FAILED')
    print('all checks passed')


if __name__ == '__main__':
    main()
