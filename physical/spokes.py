#!/usr/bin/env python3
"""
Circle-and-spokes connectors for the physical set -- ONE kit, two ways to use it.

  * XP mode (flat):   XP pieces take heads and phrases directly.
  * X' mode (X-bar):  XP -> X' -> head, with an X' piece in between.

The XP pieces are shared by both modes. Only the HEADS come in two kinds:
    X'-heads  fit only X' pieces        XP-heads  fit only XP pieces
so a head can never skip the bar level in X' mode, and a tree with all its
words placed is necessarily one mode or the other.

Connector design:
  * Round core with evenly spaced spoke positions around it. One position is
    the orientation spoke (thicker, always present: one way in); the rest are
    code spokes in two zones, alternating -- zone A deep (plug tip), zone B
    shallow (plug base).
  * A plug carries one spoke in each zone; a socket cuts a groove for every
    spoke of every plug it accepts, so a slot takes ALL the shapes the game
    allows there. Codes are found by search so that no plug that should not
    fit lands inside a socket's grooves.
  * Verified geometrically: every plug against every socket at every 6 degrees
    of rotation, and every one of the game's own trees is checked to be
    physically buildable from the kit.

Run from the repo root:  node physical/dump_rules.js && python3 physical/spokes.py
"""
import itertools, json, math, os, random, sys
from dataclasses import dataclass
from shapely.geometry import Point, LineString
from shapely.affinity import rotate

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

# --- physical parameters (mm) ------------------------------------------------
SPOKE_W = 2.4          # code spoke width
REG_W = 4.2            # orientation spoke width
SPOKE_H = 2.0          # how far a spoke stands out of the core
CLR = 0.15             # clearance per side (tune with the print coupon)
MIN_PITCH = 4.9        # least arc length between neighbouring spokes (mm)
REG_ANGLE = -90.0      # orientation spoke points "up"
ROT_STEP = 6           # degrees between rotations tested


@dataclass
class Cfg:
    n_a: int
    n_b: int
    @property
    def n_slots(self): return 1 + self.n_a + self.n_b
    @property
    def step(self): return 360 / self.n_slots
    @property
    def R(self): return max(8.0, MIN_PITCH * self.n_slots / (2 * math.pi))


# --- the kit: types, slots, and what each slot takes -------------------------
# Types: 'N1' phrase, 'N1.5' bar, 'N2' X'-head, 'N2*' XP-head.
# Each slot takes every child the game allows there, in either mode.
PORTS = {
    # phrases (shared)
    'C1':   {'L': {'D1'},           'R': {'C1.5'}},
    'T1':   {'L': {'N1', 'D1'},     'M': {'T2*'},   'R': {'V1', 'T1.5'}},
    'V1':   {'L': {'Adv1'},         'M': {'V2*'},   'R': {'N1', 'P1', 'V1.5'}},
    'D1':   {'U': {'D1.5'}},
    'N1':   {'L': {'D2*'},          'M': {'Adj1'},  'R': {'N2*', 'N1.5'}},
    'P1':   {'L': {'P2*'},          'R': {'N1', 'P1.5'}},
    'Adj1': {'U': {'Adj2*'}},
    'Adv1': {'U': {'Adv2*'}},
    # bars (X' mode only)
    'C1.5': {'L': {'C2'},           'R': {'T1'}},
    'T1.5': {'L': {'T2'},           'R': {'V1'}},
    'V1.5': {'L': {'V1.5', 'V2'},   'R': {'P1', 'D1'}},
    'D1.5': {'L': {'D2'},           'R': {'N1'}},
    'N1.5': {'U': {'N2'}},
    'P1.5': {'L': {'P2'},           'R': {'D1'}},
}
SLOT_ORDER = {'L': 0, 'M': 1, 'U': 1, 'R': 2}
SLOT_WORD = {'L': 'left', 'M': 'middle', 'R': 'right', 'U': 'only'}
LEVEL_SYMBOL = {1: 'P', 1.5: '′', 2: '⁰'}


def split_type(t):
    star = t.endswith('*')
    t = t.rstrip('*')
    shape = t.rstrip('0123456789.')
    n = float(t[len(shape):])
    return shape, (int(n) if n == int(n) else n), star


def kind(t):
    _, n, star = split_type(t)
    return 'phrase' if n == 1 else 'bar' if n == 1.5 else ('head-xp' if star else 'head-x')


def label(t):
    s, n, star = split_type(t)
    base = s + LEVEL_SYMBOL[n]
    return base + (' (XP)' if star else ' (X′)') if n == 2 else base


def load():
    with open(os.path.join(HERE, 'rules.json')) as f:
        raw = json.load(f)
    return raw['categories'], raw['modes']


def mode_edges(mode_id, modes):
    """The game's legal edges for a mode, with that mode's heads typed:
    XP-heads for the flat game, X'-heads for X-bar."""
    out = set()
    for p, c in modes[mode_id]['edges']:
        for t in (c,):
            pass
        pc = p + ('*' if split_type(p)[1] == 2 and mode_id == 'prex' else '')
        cc = c + ('*' if split_type(c)[1] == 2 and mode_id == 'prex' else '')
        out.add((pc, cc))
    return out


def check_ports_against_game(modes):
    legal = mode_edges('prex', modes) | mode_edges('xbar', modes)
    mine = {(p, c) for p, ports in PORTS.items() for kids in ports.values() for c in kids}
    if legal != mine:
        sys.exit(f'slot table disagrees with data.js: missing={sorted(legal - mine)} extra={sorted(mine - legal)}')


def can_build(parent, children):
    """Can these children (left to right) sit in the parent piece's slots,
    one per slot, in order?"""
    slots = [kids for _, kids in sorted(PORTS.get(parent, {}).items(), key=lambda kv: SLOT_ORDER[kv[0]])]
    def go(ci, si):
        if ci == len(children): return True
        for j in range(si, len(slots)):
            if children[ci] in slots[j] and go(ci + 1, j + 1):
                return True
        return False
    return go(0, 0)


def check_trees(mode_id, modes):
    """Every one of the game's own trees must be buildable from the kit."""
    star = lambda n: '*' if (n['n'] == 2 and mode_id == 'prex') else ''
    ty = lambda n: f'{n["s"]}{n["n"]}{star(n)}'
    bad, nodes = [], 0
    def walk(node, name):
        nonlocal nodes
        nodes += 1
        if node['c'] and not can_build(ty(node), [ty(c) for c in node['c']]):
            bad.append((name, ty(node), [ty(c) for c in node['c']]))
        for c in node['c']:
            walk(c, name)
    for t in modes[mode_id]['trees']:
        walk(t['tree'], t['name'])
    return len(modes[mode_id]['trees']), nodes, bad


def key_name(kids):
    return '->' + '|'.join(sorted(kids))


# --- code assignment ---------------------------------------------------------
def assign_codes(keys, accepts, cfg, node_limit=40000, attempts=60, seed=0):
    """DFS: give each key a distinct (a, b) so that for every socket, no plug
    it should refuse falls inside (its accepted a's) x (its accepted b's)."""
    rng = random.Random(seed)
    codes = list(itertools.product(range(cfg.n_a), range(cfg.n_b)))
    sockets = {c: ks for c, ks in accepts.items() if ks}
    users = {k: [c for c, ks in sockets.items() if k in ks] for k in keys}
    order = sorted(keys, key=lambda k: -len(users[k]))

    def ok(asg, k):
        # k as a plug that some socket must refuse
        for c, ks in sockets.items():
            if k in ks: continue
            sa = {asg[x][0] for x in ks if x in asg}
            sb = {asg[x][1] for x in ks if x in asg}
            if asg[k][0] in sa and asg[k][1] in sb: return False
        # k widening the grooves of sockets that accept it
        for c in users[k]:
            ks = sockets[c]
            sa = {asg[x][0] for x in ks if x in asg}
            sb = {asg[x][1] for x in ks if x in asg}
            for p in asg:
                if p not in ks and asg[p][0] in sa and asg[p][1] in sb: return False
        return True

    for _ in range(attempts):
        asg, used, nodes = {}, set(), [0]
        def dfs(i):
            if i == len(order): return True
            k = order[i]
            cand = [c for c in codes if c not in used]
            rng.shuffle(cand)
            for code in cand:
                nodes[0] += 1
                if nodes[0] > node_limit: return False
                asg[k] = code; used.add(code)
                if ok(asg, k) and dfs(i + 1): return True
                del asg[k]; used.discard(code)
            return False
        if dfs(0): return asg
    return None


def choose_grid(keys, accepts):
    for n in range(3, 10):
        for na, nb in ((n, n), (n + 1, n)):
            if na * nb < len(keys) + 4:
                continue
            cfg = Cfg(na, nb)
            asg = assign_codes(keys, accepts, cfg)
            if asg:
                return cfg, asg
    sys.exit('no grid found')


# --- geometry ----------------------------------------------------------------
def spoke(theta, width, r0, r1):
    s = LineString([(r0, 0), (r1 - width / 2, 0)]).buffer(width / 2, 12)
    return rotate(s, theta, origin=(0, 0))


class Spokes:
    def __init__(self, cfg, with_reg=True):
        self.cfg, self.with_reg = cfg, with_reg
        angles = [REG_ANGLE + cfg.step * i for i in range(cfg.n_slots)]
        self.angles, self.reg = angles, angles[0]
        self.ang_a, self.ang_b = angles[1::2], angles[2::2]
        assert (len(self.ang_a), len(self.ang_b)) == (cfg.n_a, cfg.n_b)
        self.R = cfg.R
        self.r0, self.r1 = self.R - 0.8, self.R + SPOKE_H

    def parts(self, code):
        a, b = code
        return dict(core=Point(0, 0).buffer(self.R, 96),
                    a=spoke(self.ang_a[a], SPOKE_W, self.r0, self.r1),
                    b=spoke(self.ang_b[b], SPOKE_W, self.r0, self.r1),
                    reg=spoke(self.reg, REG_W, self.r0, self.r1))

    def plug(self, code):
        p = self.parts(code)
        tip = p['core'].union(p['a'])
        if self.with_reg: tip = tip.union(p['reg'])
        return tip, tip.union(p['b'])

    def socket(self, codes, clr=None):
        clr = CLR if clr is None else clr
        w, r1 = SPOKE_W + 2 * clr, self.r1 + clr
        deep = Point(0, 0).buffer(self.R + clr, 96)
        if self.with_reg: deep = deep.union(spoke(self.reg, REG_W + 2 * clr, self.r0, r1))
        for a in {c[0] for c in codes}: deep = deep.union(spoke(self.ang_a[a], w, self.r0, r1))
        shallow = deep
        for b in {c[1] for c in codes}: shallow = shallow.union(spoke(self.ang_b[b], w, self.r0, r1))
        return deep.buffer(1e-6), shallow.buffer(1e-6)


def fits(plug, sock):
    return sock[0].contains(plug[0]) and sock[1].contains(plug[1])


def rotations(geo, keys, asg):
    """Rotated plug sections, built once and reused against every socket."""
    cache = {}
    for k in keys:
        tip, prox = geo.plug(asg[k])
        for rot in range(ROT_STEP, 360, ROT_STEP):
            cache[(k, rot)] = (rotate(tip, rot, origin=(0, 0)), rotate(prox, rot, origin=(0, 0)))
    return cache


# --- verification ------------------------------------------------------------
def verify(types, keys, accepts, asg, cfg):
    geo = Spokes(cfg)
    plugs = {k: geo.plug(asg[k]) for k in keys}
    socks = {c: geo.socket([asg[k] for k in accepts[c]]) for c in types if accepts[c]}
    wrong, missed = [], []
    for k in keys:
        for c, z in socks.items():
            f = fits(plugs[k], z)
            if f and c not in k: wrong.append((key_name(k), c))
            if c in k and not f: missed.append((key_name(k), c))
    rc = rotations(geo, keys, asg)
    spun = sum(fits(rc[(k, r)], z) for (k, r) in rc for z in socks.values())

    ng = Spokes(cfg, with_reg=False)
    nrc = rotations(ng, keys, asg)
    nsocks = {c: ng.socket([asg[k] for k in accepts[c]]) for c in types if accepts[c]}
    spun_noreg = sum(fits(nrc[(k, r)], z) for (k, r) in nrc for z in nsocks.values())

    rng, caught, tried = random.Random(1), 0, 0
    codes = list(itertools.product(range(cfg.n_a), range(cfg.n_b)))
    for _ in range(80):
        rng.shuffle(codes)
        bad = dict(zip(keys, codes[:len(keys)]))
        if all_valid(bad, accepts): continue
        tried += 1
        bp = {k: geo.plug(bad[k]) for k in keys}
        bs = {c: geo.socket([bad[k] for k in accepts[c]]) for c in types if accepts[c]}
        caught += any(fits(bp[k], z) and c not in k for k in keys for c, z in bs.items())
        if tried == 20: break
    return dict(wrong=wrong, missed=missed, spun=spun, spun_noreg=spun_noreg,
                pairs=len(keys) * len(socks), selftest=(caught, tried))


def all_valid(asg, accepts):
    for ks in accepts.values():
        if not ks: continue
        sa = {asg[k][0] for k in ks}; sb = {asg[k][1] for k in ks}
        if any(p not in ks and a in sa and b in sb for p, (a, b) in asg.items()): return False
    return True


# --- drawing -----------------------------------------------------------------
def shade(hexcol, f):
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


def draw_plug(geo, code, color, cx, cy, s):
    p = geo.parts(code)
    return (f'<path d="{gpath(p["core"], s, cx, cy)}" fill="{shade(color, .25)}" stroke="{shade(color, -.4)}" stroke-width="1"/>'
            f'<path d="{gpath(p["b"], s, cx, cy)}" fill="{shade(color, .55)}" stroke="{shade(color, -.4)}" stroke-width="1"/>'
            f'<path d="{gpath(p["a"], s, cx, cy)}" fill="{shade(color, -.3)}" stroke="{shade(color, -.6)}" stroke-width="1"/>'
            f'<path d="{gpath(p["reg"], s, cx, cy)}" fill="#fff" stroke="{shade(color, -.5)}" stroke-width="1.2"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{s * 1.1:.1f}" fill="{shade(color, -.35)}" opacity=".55"/>')


def draw_socket(geo, codes, color, cx, cy, s):
    deep, shallow = geo.socket(codes)
    outer = Point(0, 0).buffer(geo.R + SPOKE_H + 2.6, 96)
    return (f'<path d="{gpath(outer, s, cx, cy)}" fill="{color}" stroke="{shade(color, -.4)}" stroke-width="1.2"/>'
            f'<path d="{gpath(outer.buffer(-0.7), s, cx, cy)}" fill="none" stroke="{shade(color, .45)}" stroke-width="1"/>'
            f'<path d="{gpath(shallow, s, cx, cy)}" fill="#fff" stroke="{shade(color, -.5)}" stroke-width="1.2"/>'
            f'<path d="{gpath(deep, s, cx, cy)}" fill="#d9dde3" stroke="none"/>'
            f'<path d="{gpath(shallow, s, cx, cy)}" fill="none" stroke="{shade(color, -.5)}" stroke-width="1.2"/>')


def sheet(res, cats, path):
    geo, cfg, s = res['geo'], res['cfg'], 3.2
    asg, accepts = res['asg'], res['accepts']
    sections = [
        ('Phrases (XP) — shared by both modes', [t for t in res['types'] if kind(t) == 'phrase'], 2),
        ('Bars (X′) — X′ mode only', [t for t in res['types'] if kind(t) == 'bar'], 3),
        ('Heads for X′ mode — fit only X′ pieces', [t for t in res['types'] if kind(t) == 'head-x'], 6),
        ('Heads for XP mode — fit only XP pieces', [t for t in res['types'] if kind(t) == 'head-xp'], 6),
    ]
    pitch = 2 * (geo.R + SPOKE_H + 2.6) * s + 14        # room for one socket/plug
    W = 1120
    body, y = [], 220

    def card_w(t):
        n = len(PORTS.get(t, {}))
        return pitch * (1 + n) + 24

    for title, types, cols in sections:
        if not types: continue
        body.append(f'<text x="24" y="{y + 20}" font-size="19" font-weight="700" fill="#333">{title}</text>')
        y += 34
        cw = (W - 48) / cols
        ch = 214 if any(PORTS.get(t) for t in types) else 214
        for i, t in enumerate(types):
            ox, oy = 24 + (i % cols) * cw, y + (i // cols) * ch
            shape, n, star = split_type(t)
            color = cats[shape]['color']
            xp_head = kind(t) == 'head-xp'
            body.append(f'<rect x="{ox + 4}" y="{oy}" width="{cw - 8}" height="{ch - 8}" rx="14" '
                        f'fill="{"#fff8ee" if xp_head else "#fff"}" stroke="{"#f0d9b5" if xp_head else "#dde1ea"}"/>')
            body.append(icon(cats[shape]['shape'], color, ox + 38, oy + 36, 17, str(n)))
            body.append(f'<text x="{ox + 66}" y="{oy + 31}" font-size="17" font-weight="700" fill="#222">{label(t)}</text>')
            body.append(f'<text x="{ox + 66}" y="{oy + 48}" font-size="11" fill="#667">{cats[shape]["name"]}</text>')
            py = oy + 106
            sx = ox + 12 + pitch / 2
            body.append(draw_socket(geo, [asg[k] for k in accepts[t]], color, sx, py, s))
            parents = sorted({f'{label(p)}.{nm}' for p, pp in PORTS.items() for nm, k in pp.items() if t in k})
            body.append(f'<text x="{sx}" y="{oy + ch - 34}" text-anchor="middle" font-size="10" fill="#667">top socket</text>')
            body.append(f'<text x="{sx}" y="{oy + ch - 22}" text-anchor="middle" font-size="9" fill="#889">'
                        f'{", ".join(parents)[:26] or "root"}</text>')
            arms = sorted(PORTS.get(t, {}).items(), key=lambda kv: SLOT_ORDER[kv[0]])
            for j, (nm, kids) in enumerate(arms):
                ax = sx + pitch * (j + 1)
                body.append(f'<path d="M{ax - pitch + pitch * .42},{py} L{ax - pitch * .42},{py}" stroke="#c9cfdb" '
                            f'stroke-width="2" stroke-dasharray="3 4"/>')
                body.append(draw_plug(geo, asg[frozenset(kids)], color, ax, py, s))
                takes = ' · '.join(label(k) for k in sorted(kids))
                body.append(f'<text x="{ax}" y="{oy + ch - 34}" text-anchor="middle" font-size="10" fill="#667">'
                            f'{SLOT_WORD[nm]} arm</text>')
                body.append(f'<text x="{ax}" y="{oy + ch - 21}" text-anchor="middle" font-size="10.5" font-weight="700" '
                            f'fill="{shade(color, -.35)}">{takes}</text>')
        y += math.ceil(len(types) / cols) * ch + 14
    H = y + 10
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="Helvetica,Arial,sans-serif">',
           '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f8fb"/>'
           '<stop offset="1" stop-color="#eef0f5"/></linearGradient></defs>',
           f'<rect width="{W}" height="{H}" fill="url(#bg)"/>',
           f'<text x="24" y="40" font-size="26" font-weight="700" fill="#222">Shapes and Language — block kit</text>',
           f'<text x="24" y="63" font-size="13" fill="#555">{len(res["types"])} pieces · XP mode uses the phrases and XP heads · '
           f'X′ mode uses the phrases, bars and X′ heads · every slot takes all the shapes the game allows there</text>']
    kx, ky, ks = 24 + 78, 138, 3.0
    svg.append(f'<path d="{gpath(Point(0, 0).buffer(geo.R + SPOKE_H + 2.6, 96), ks, kx, ky)}" fill="#fff" stroke="#bbb"/>')
    svg.append(f'<path d="{gpath(Point(0, 0).buffer(geo.R, 96), ks, kx, ky)}" fill="#e6e9ef" stroke="#999"/>')
    for i, th in enumerate(geo.angles):
        w = REG_W if i == 0 else SPOKE_W
        col = '#ffffff' if i == 0 else ('#4a5a78' if i % 2 else '#9fb0cf')
        svg.append(f'<path d="{gpath(spoke(th, w, geo.R - 0.8, geo.R + SPOKE_H), ks, kx, ky)}" fill="{col}" stroke="#667"/>')
        tx = kx + math.cos(math.radians(th)) * ks * (geo.R + SPOKE_H + 5.4)
        ty = ky + math.sin(math.radians(th)) * ks * (geo.R + SPOKE_H + 5.4)
        name = 'up' if i == 0 else (f'A{(i - 1) // 2 + 1}' if i % 2 else f'B{(i - 2) // 2 + 1}')
        svg.append(f'<text x="{tx:.1f}" y="{ty + 4:.1f}" text-anchor="middle" font-size="10.5" fill="#556">{name}</text>')
    lx = kx + 140
    for j, (txt, col) in enumerate([('white spoke: orientation key, one way in', '#ffffff'),
                                    ('dark spokes (A): the plug tip, deepest in the socket', '#4a5a78'),
                                    ('pale spokes (B): near the base of the plug', '#9fb0cf'),
                                    (f'{cfg.n_slots} positions, evenly spaced every {cfg.step:.1f}°, on a {2 * geo.R:.1f} mm core', None),
                                    ('cream cards: heads that fit XP pieces', '#fff8ee')]):
        yy = 108 + j * 21
        if col: svg.append(f'<rect x="{lx}" y="{yy - 11}" width="22" height="13" rx="3" fill="{col}" stroke="#667"/>')
        svg.append(f'<text x="{lx + 32}" y="{yy}" font-size="13" fill="#333">{txt}</text>')
    svg += body + ['</svg>']
    open(path, 'w').write('\n'.join(svg))


def write_report(res, cats, modes, tree_stats, path):
    cfg, asg, accepts = res['cfg'], res['asg'], res['accepts']
    v = res['verify']
    L = ['# Block kit: circle-and-spokes connectors, derived from the game\n',
         'Generated by `physical/spokes.py` from `data.js` (via `physical/dump_rules.js`). Do not edit by hand.\n',
         'One kit, two ways to use it. The XP pieces are shared; only the heads come in two kinds. '
         '**XP-heads fit only XP pieces, X′-heads fit only X′ pieces**, so a head cannot skip the bar level in X′ mode, '
         'and a tree with all its words placed is one mode or the other.\n',
         f'- {cfg.n_slots} spoke positions evenly spaced every {cfg.step:.1f}° on a {2 * res["geo"].R:.1f} mm core: one thick '
         f'orientation spoke plus {cfg.n_a} deep (A) and {cfg.n_b} shallow (B) code positions = {cfg.n_a * cfg.n_b} codes, '
         f'{len(res["keys"])} used.',
         f'- Spokes {SPOKE_W} mm wide (orientation spoke {REG_W} mm), {SPOKE_H} mm tall, clearance {CLR} mm per side.',
         f'- **Wrong-pair test:** {v["pairs"]} plug x socket pairs checked geometrically: wrongly fitting **{len(v["wrong"])}**, '
         f'correct pairs that fail **{len(v["missed"])}**.',
         f'- **Orientation:** every plug at every {ROT_STEP}° of rotation against every socket seats at a wrong rotation '
         f'**{v["spun"]}** times (without the thick spoke: {v["spun_noreg"]}).',
         f'- **Self-check:** the geometry test flagged wrong fits in {v["selftest"][0]} of {v["selftest"][1]} deliberately invalid code assignments.\n',
         '## The game\'s own trees\n',
         'Every Level 1 target and Level 2 sentence tree was checked to be physically buildable from the kit '
         '(every node\'s children fit its slots, one per slot, in order):\n']
    for mid, (nt, nn, bad) in tree_stats.items():
        L.append(f'- **{ {"prex": "XP mode (flat)", "xbar": "X′ mode (X-bar)"}[mid] }:** {nt} trees, {nn} nodes, '
                 f'**{len(bad)}** that cannot be built.')
        for b in bad: L.append(f'  - {b}')
    kits = res['kits']
    L += ['', '## Pieces needed per mode\n', '| | XP mode | X′ mode | Whole kit |', '|---|---|---|---|']
    for k, nm in (('phrase', 'Phrases (XP)'), ('bar', 'Bars (X′)'), ('head-x', 'X′ heads'), ('head-xp', 'XP heads')):
        cnt = lambda s: sum(1 for t in s if kind(t) == k)
        L.append(f'| {nm} | {cnt(kits["prex"])} | {cnt(kits["xbar"])} | {cnt(res["types"])} |')
    L.append(f'| **Designs** | **{len(kits["prex"])}** | **{len(kits["xbar"])}** | **{len(res["types"])}** |')
    L += ['', '## Pieces\n', '| Piece | Hangs from | Arms, left to right (each takes ALL of these) |', '|---|---|---|']
    for t in res['types']:
        frm = ', '.join(sorted(f'{label(p)}.{n}' for p, pp in PORTS.items() for n, k in pp.items() if t in k)) or '(root only)'
        arms = '; '.join(f'{SLOT_WORD[n]}: {" or ".join(label(k) for k in sorted(kids))} [code {asg[frozenset(kids)]}]'
                         for n, kids in sorted(PORTS.get(t, {}).items(), key=lambda kv: SLOT_ORDER[kv[0]])) or '(head, no arms)'
        L.append(f'| {label(t)} | {frm} | {arms} |')
    L.append('\nDrawing: `physical/out/spokes.svg` (and `.png`).')
    open(path, 'w').write('\n'.join(L) + '\n')


def design():
    """The kit: piece types, plug keys, which keys each socket takes, and the
    spoke codes. Shared by the report/drawing script and the STL coupon."""
    cats, modes = load()
    check_ports_against_game(modes)
    types = sorted({t for p, pp in PORTS.items() for k in pp.values() for t in (p, *k)},
                   key=lambda t: (['phrase', 'bar', 'head-x', 'head-xp'].index(kind(t)),
                                  list(cats).index(split_type(t)[0])))
    keys = sorted({frozenset(k) for pp in PORTS.values() for k in pp.values()}, key=sorted)
    accepts = {c: {k for k in keys if c in k} for c in types}
    cfg, asg = choose_grid(keys, accepts)
    return cats, modes, types, keys, accepts, cfg, asg


def main():
    cats, modes, types, keys, accepts, cfg, asg = design()
    print(f'{len(types)} pieces, {len(keys)} plug keys -> grid {cfg.n_a}x{cfg.n_b} '
          f'({cfg.n_slots} slots, {cfg.step:.1f} deg apart, R={cfg.R:.1f} mm)')
    res = dict(types=types, keys=keys, accepts=accepts, asg=asg, cfg=cfg, geo=Spokes(cfg))
    res['verify'] = v = verify(types, keys, accepts, asg, cfg)
    res['kits'] = {m: {t for e in mode_edges(m, modes) for t in e} for m in ('prex', 'xbar')}
    tree_stats = {m: check_trees(m, modes) for m in ('prex', 'xbar')}
    print(f'pairs={v["pairs"]} wrong={len(v["wrong"])} missed={len(v["missed"])} spun={v["spun"]} '
          f'(no orientation spoke: {v["spun_noreg"]}) selftest={v["selftest"][0]}/{v["selftest"][1]}')
    for m, (nt, nn, bad) in tree_stats.items():
        print(f'trees [{m}]: {nt} trees / {nn} nodes, unbuildable: {len(bad)}')
        for b in bad[:5]: print('   ', b)
    print('kit sizes: flat', len(res['kits']['prex']), '| xbar', len(res['kits']['xbar']), '| whole', len(types))
    sheet(res, cats, os.path.join(OUT, 'spokes.svg'))
    json.dump(dict(
        params=dict(SPOKE_W=SPOKE_W, REG_W=REG_W, SPOKE_H=SPOKE_H, CLR=CLR, R=cfg.R, n_slots=cfg.n_slots,
                    n_a=cfg.n_a, n_b=cfg.n_b),
        angles=dict(reg=res['geo'].reg, A=res['geo'].ang_a, B=res['geo'].ang_b),
        keys={key_name(k): dict(code=asg[k], takes=sorted(k)) for k in keys},
        sockets={c: sorted(key_name(k) for k in accepts[c]) for c in types},
        slots={p: {n: sorted(k) for n, k in pp.items()} for p, pp in PORTS.items()},
    ), open(os.path.join(OUT, 'spokes.json'), 'w'), indent=1)
    write_report(res, cats, modes, tree_stats, os.path.join(HERE, 'SPOKES.md'))
    failed = v['wrong'] or v['missed'] or v['spun'] or any(b for _, _, b in tree_stats.values())
    if failed:
        sys.exit('VERIFICATION FAILED')
    print('all checks passed')


if __name__ == '__main__':
    main()
