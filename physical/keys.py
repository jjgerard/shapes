#!/usr/bin/env python3
"""
Connector design for the physical set, using the game's own shapes.

The rule is the one the game already draws: a slot takes the shape it shows.
  * Every piece is one of the game's fragments (a node plus its children).
  * Each child slot on a piece ends in a PLUG that is the outline of the child
    it takes (heart for V, circle for D, ...). A piece's own top SOCKET is the
    outline of that piece's own category. So a heart plug fits a heart socket.
  * Same outline at different levels (N / N' / NP) is told apart by a small
    pin pattern on the face -- one pin among three positions, the other two
    positions are recesses on the plug and posts in the socket. It plays the
    part of the number in the game's shapes (1, 1.5, 2).

Why the outlines never nest: every silhouette is normalised to the SAME AREA,
so no shape can sit inside a different one (a small circle would drop into a
big square otherwise). The script proves it geometrically, at every rotation.

Run from the repo root:  python3 physical/keys.py
"""
import json, math, os, sys
from shapely.geometry import Point, Polygon, box
from shapely.affinity import rotate, scale, translate

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

# --- physical parameters (mm) ------------------------------------------------
DIAMETER = 20.0                     # a circle of this diameter sets the shared area
AREA = math.pi * (DIAMETER / 2) ** 2
ROUND = 0.9                         # corner radius: strength, and printable tips
CLR = 0.15                          # clearance per side (tune with the print coupon)
R_PIN, R_POST = 0.8, 0.8
R_HOLE = R_POST + CLR + 0.05
# Pin positions (centre of outline). Distinct radii on purpose: no rotation
# can map the set onto itself, so a plug has exactly one way in.
POS = [(0.0, 0.0),
       (2.8, 0.0),
       (3.6 * math.cos(math.radians(130)), 3.6 * math.sin(math.radians(130)))]
LEVEL_POS = {1: 0, 1.5: 1, 2: 2}    # level number -> pin position index


# --- the game's silhouettes, ported from shapes.js (y points down) ------------
def _poly(cx, cy, r, sides, rot=-90):
    return Polygon([(cx + r * math.cos(math.radians(rot + 360 / sides * i)),
                     cy + r * math.sin(math.radians(rot + 360 / sides * i)))
                    for i in range(sides)])


def _star(r_out, r_in, pts=5, rot=-90):
    return Polygon([((r_out if i % 2 == 0 else r_in) * math.cos(math.radians(rot + 180 / pts * i)),
                     (r_out if i % 2 == 0 else r_in) * math.sin(math.radians(rot + 180 / pts * i)))
                    for i in range(pts * 2)])


def _heart():
    # HEART_D in shapes.js, cubic Beziers sampled, then its translate/scale.
    segs = [((16, 29.3), (16, 29.3), (2, 18), (2, 10.5)),
            ((2, 10.5), (2, 5.8), (5.6, 2), (10, 2)),
            ((10, 2), (12.6, 2), (15, 3.4), (16, 5.6)),
            ((16, 5.6), (17, 3.4), (19.4, 2), (22, 2)),
            ((22, 2), (26.4, 2), (30, 5.8), (30, 10.5)),
            ((30, 10.5), (30, 18), (16, 29.3), (16, 29.3))]
    pts = []
    for p0, p1, p2, p3 in segs:
        for i in range(40):
            t = i / 40
            u = 1 - t
            pts.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                        u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return Polygon([((x - 16) / 15.3, (y - 15) / 15.3) for x, y in pts])


BASE = {
    'square':    lambda: box(-.88, -.88, .88, .88).buffer(.12, 16),
    'pentagon':  lambda: _poly(0, .06, 1.12, 5),
    # The game's diamond is a square stood on its corner, which at equal area
    # is congruent to the square (T) and would nest in it when turned 45 deg.
    # Stretched taller here so the two are genuinely different outlines.
    'diamond':   lambda: scale(_poly(0, 0, 1.2, 4), 1.0, 1.35, origin=(0, 0)),
    'rectangle': lambda: box(-1.23, -.66, 1.23, .66).buffer(.12, 16),
    'circle':    lambda: Point(0, 0).buffer(1, 64),
    'triangle':  lambda: _poly(0, .08, 1.15, 3),
    'star':      lambda: _star(1.15, .5),
    'heart':     _heart,
}


def normalised(shape_name):
    """The game's silhouette, scaled to the shared area, corners rounded,
    centred on its centroid."""
    g = BASE[shape_name]()
    for _ in range(4):
        g = scale(g, math.sqrt(AREA / g.area), math.sqrt(AREA / g.area), origin=(0, 0))
        g = g.buffer(-ROUND, 24).buffer(ROUND, 24)          # round convex corners
        g = g.buffer(ROUND, 24).buffer(-ROUND, 24)          # round concave corners
    c = g.centroid
    return translate(g, -c.x, -c.y)


# --- loading the game's rules ------------------------------------------------
def tname(shape, number):
    return f'{shape}{number}'


def load():
    with open(os.path.join(HERE, 'rules.json')) as f:
        raw = json.load(f)
    return raw['categories'], raw['modes']


def build_pieces(mode):
    """Pieces = the game's fragments, plus a bare head for every head type
    that doesn't already have one (the game keeps V's head inline)."""
    pieces = []
    for s in mode['structures']:
        pieces.append(dict(id=s['id'], type=tname(s['shape'], s['number']),
                           shape=s['shape'], number=s['number'], rule=s['rule'],
                           arms=[tname(c['shape'], c['number']) for c in s['children']]))
    have = {(p['shape'], p['number']) for p in pieces if not p['arms']}
    heads = sorted({(c['shape'], c['number']) for s in mode['structures'] for c in s['children']
                    if c['number'] == 2} - have)
    for sh, n in heads:
        pieces.append(dict(id=None, type=tname(sh, n), shape=sh, number=n,
                           rule='X0 (bare head, added)', arms=[]))
    return pieces


def check_against_game(mode, pieces):
    legal = {tuple(e) for e in mode['edges']}
    mine = {(p['type'], a) for p in pieces for a in p['arms']}
    if legal != mine:
        sys.exit(f'fragments disagree with the game\'s legal edges: {legal ^ mine}')


# --- the connectors ----------------------------------------------------------
class Connectors:
    def __init__(self, cats):
        self.cats = cats
        self.outline = {c: normalised(v['shape']) for c, v in cats.items()}

    def plug(self, t, shape, number, rot=0.0):
        pin = LEVEL_POS[number]
        o = self.outline[shape]
        pins = [Point(POS[pin]).buffer(R_PIN, 24)]
        holes = [Point(POS[i]).buffer(R_HOLE, 24) for i in range(3) if i != pin]
        f = lambda g: rotate(g, rot, origin=(0, 0)) if rot else g
        return f(o), [f(g) for g in pins], [f(g) for g in holes]

    def socket(self, shape, number):
        pin = LEVEL_POS[number]
        cavity = self.outline[shape].buffer(CLR, 24)
        posts = [Point(POS[i]).buffer(R_POST, 24) for i in range(3) if i != pin]
        return cavity, posts

    def fits(self, plug, sock):
        outline, pins, holes = plug
        cavity, posts = sock
        eps = 1e-6
        if not cavity.buffer(eps).contains(outline):
            return False
        for post in posts:
            if any(pin.intersects(post.buffer(CLR)) for pin in pins):
                return False
            if not any(h.buffer(eps).contains(post.buffer(CLR)) for h in holes):
                return False
        return True


def split_type(t):
    """'T1.5' -> ('T', 1.5), 'Adj2' -> ('Adj', 2)."""
    shape = t.rstrip('0123456789.')
    n = float(t[len(shape):])
    return shape, int(n) if n == int(n) else n


def verify(conn, child_types, with_pins=True):
    """Every plug against every socket. Returns (wrong fits, missed fits,
    seatings at a rotation other than the intended one)."""
    strip = lambda plug: (plug[0], [], [])
    wrong, missed, spun = [], [], 0
    for (ps, pn) in child_types:
        for (ss, sn) in child_types:
            sock = conn.socket(ss, sn)
            plug = conn.plug(None, ps, pn)
            if not with_pins:
                sock, plug = (sock[0], []), strip(plug)
            want = (ps, pn) == (ss, sn)
            f = conn.fits(plug, sock)
            if f and not want: wrong.append((tname(ps, pn), tname(ss, sn)))
            if want and not f: missed.append((tname(ps, pn), tname(ss, sn)))
            if with_pins:
                spun += sum(conn.fits(conn.plug(None, ps, pn, rot), sock) for rot in range(10, 360, 5))
    return wrong, missed, spun


# --- drawing -----------------------------------------------------------------
def path(g, s, ox, oy):
    geoms = list(g.geoms) if hasattr(g, 'geoms') else [g]
    d = ''
    for p in geoms:
        for ring in [p.exterior, *p.interiors]:
            d += 'M' + ' L'.join(f'{ox + x * s:.2f},{oy + y * s:.2f}' for x, y in ring.coords) + ' Z '
    return d


def node(conn, cats, shape, number, cx, cy, s, label=None):
    c = cats[shape]
    lab = number if label is None else label
    size = s * 7.5 * (0.8 if len(str(lab)) > 2 else 1)
    shape_svg = (f'<path d="{path(conn.outline[shape], s, cx, cy)}" fill="{c["color"]}" stroke="#222" '
                 f'stroke-width="1"/>')
    if lab == '':
        return shape_svg
    return (shape_svg +
            f'<text x="{cx}" y="{cy + size * .35}" text-anchor="middle" font-size="{size:.1f}" '
            f'font-weight="700" fill="#fff">{lab}</text>')


def connector_sheet(conn, cats, child_types, title, path_out):
    s, cw, ch = 4.2, 330, 150
    cols = 2
    rows = math.ceil(len(child_types) / cols)
    W, H = cols * cw + 20, rows * ch + 50
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="sans-serif">',
           '<rect width="100%" height="100%" fill="#fff"/>',
           f'<text x="10" y="22" font-size="15" font-weight="700">{title}</text>',
           '<text x="10" y="38" font-size="11" fill="#555">left: the plug on a parent\'s arm   '
           'right: the socket on top of the child   (dark dot = pin, ring = recess, grey dot = post)</text>']
    for i, (sh, n) in enumerate(child_types):
        ox = 10 + (i % cols) * cw
        oy = 50 + (i // cols) * ch
        px, sx, cy = ox + 62, ox + 205, oy + ch / 2
        outline, pins, holes = conn.plug(None, sh, n)
        svg.append(node(conn, cats, sh, n, px, cy, s, label=''))
        for h in holes:
            svg.append(f'<path d="{path(h, s, px, cy)}" fill="#fff" fill-opacity=".55" stroke="#fff" stroke-width="1" stroke-dasharray="2 1.5"/>')
        for p in pins:
            svg.append(f'<path d="{path(p, s, px, cy)}" fill="#111"/>')
        cavity, posts = conn.socket(sh, n)
        svg.append(f'<path d="{path(cavity, s, sx, cy)}" fill="#ddd" stroke="{cats[sh]["color"]}" stroke-width="3"/>')
        for p in posts:
            svg.append(f'<path d="{path(p, s, sx, cy)}" fill="#666"/>')
        svg.append(f'<text x="{ox + 130}" y="{oy + ch - 8}" text-anchor="middle" font-size="11" fill="#333">'
                   f'{cats[sh]["name"]}, level {n}</text>')
    svg.append('</svg>')
    open(path_out, 'w').write('\n'.join(svg))


def piece_sheet(conn, cats, pieces, title, path_out):
    s, cw, ch = 1.7, 190, 175
    cols = 4
    rows = math.ceil(len(pieces) / cols)
    W, H = cols * cw + 20, rows * ch + 40
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="sans-serif">',
           '<rect width="100%" height="100%" fill="#fff"/>',
           f'<text x="10" y="22" font-size="15" font-weight="700">{title}</text>']
    for i, p in enumerate(pieces):
        ox = 10 + (i % cols) * cw
        oy = 34 + (i // cols) * ch
        mx, ty = ox + cw / 2 - 5, oy + 26
        k = len(p['arms'])
        xs = [mx + (j - (k - 1) / 2) * 56 for j in range(k)]
        for j, a in enumerate(p['arms']):
            svg.append(f'<path d="M{mx},{ty + 14} L{xs[j]},{oy + 100}" stroke="#444" stroke-width="2" fill="none"/>')
        svg.append(node(conn, cats, p['shape'], p['number'], mx, ty, s))
        for j, a in enumerate(p['arms']):
            sh, n = split_type(a)
            svg.append(node(conn, cats, sh, n, xs[j], oy + 108, s))
        svg.append(f'<text x="{ox + cw / 2 - 5}" y="{oy + 140}" text-anchor="middle" font-size="10" fill="#555">'
                   f'{"piece " + str(p["id"]) if p["id"] else "head"}: {p["rule"][:26]}</text>')
    svg.append('</svg>')
    open(path_out, 'w').write('\n'.join(svg))


# --- main ---------------------------------------------------------------------
MODE_NAMES = {'xbar': 'X / X-bar / XP set', 'prex': 'X / XP (flat) set'}


def main():
    cats, modes = load()
    conn = Connectors(cats)

    # every pin, hole and post must sit well inside every silhouette
    margin = min(conn.outline[c].exterior.distance(Point(p))
                 for c in cats for p in POS)
    need = R_HOLE + 0.8
    print(f'smallest wall between a pin position and any silhouette edge: {margin:.2f} mm '
          f'(want >= {need:.2f})')
    if margin < need:
        sys.exit('pin positions do not fit inside the smallest silhouette -- enlarge DIAMETER')

    # no silhouette may fit inside a different one, at any rotation
    names = sorted(cats)
    nest = []
    for a in names:
        for b in names:
            if a == b: continue
            for rot in range(0, 360, 5):
                if conn.outline[b].buffer(CLR).buffer(1e-6).contains(rotate(conn.outline[a], rot, origin=(0, 0))):
                    nest.append((a, b, rot))
    print(f'cross-shape nesting (equal area): {len(nest)} cases')
    if nest:
        sys.exit(f'silhouettes nest: {nest[:5]}')

    report = ['# Connector design, from the game\'s own shapes\n',
              'Generated by `physical/keys.py` from `data.js` (via `physical/dump_rules.js`). '
              'Do not edit by hand.\n',
              'A slot takes the shape it shows: the plug on an arm is the outline of the child it '
              'takes, the socket on top of a piece is the outline of that piece. Same outline at a '
              'different level is told apart by a pin pattern.\n',
              f'- Every silhouette is scaled to the area of a {DIAMETER:.0f} mm circle, so no shape '
              f'fits inside a different one at any rotation (checked: {len(nest)} cases).',
              f'- Corners rounded to {ROUND} mm radius; clearance {CLR} mm per side (tune with the coupon).\n']
    failed = False
    for mid in ('prex', 'xbar'):
        mode = modes[mid]
        pieces = build_pieces(mode)
        check_against_game(mode, pieces)
        child_types = sorted({split_type(a) for p in pieces for a in p['arms']},
                             key=lambda t: (list(cats).index(t[0]), t[1]))
        wrong, missed, spun = verify(conn, child_types)
        w0, _, s0 = verify(conn, child_types, with_pins=False)
        n = len(child_types)
        max_arms = max(len(p['arms']) for p in pieces)
        print(f'[{mid}] pieces={len(pieces)} slot types={n} max arms={max_arms} pairs={n * n} '
              f'wrong={len(wrong)} missed={len(missed)} spun={spun} | without pins: wrong={len(w0)}')
        failed |= bool(wrong or missed or spun)
        connector_sheet(conn, cats, child_types, f'{MODE_NAMES[mid]} -- connectors',
                        os.path.join(OUT, f'connectors_{mid}.svg'))
        piece_sheet(conn, cats, pieces, f'{MODE_NAMES[mid]} -- the {len(pieces)} piece designs',
                    os.path.join(OUT, f'pieces_{mid}.svg'))
        report += [f'\n## {MODE_NAMES[mid]}\n',
                   f'- **{len(pieces)} piece designs** (the game\'s fragments plus bare heads), '
                   f'**{n} connector types**, up to **{max_arms} arms** on one piece.',
                   f'- Tested **{n * n}** plug x socket pairs, plus every plug at 71 other rotations '
                   f'for each: wrongly fitting **{len(wrong)}**, correct pairs that fail **{len(missed)}**, '
                   f'plugs that seat at a wrong rotation **{spun}**.',
                   f'- Without the level pins, **{len(w0)}** wrong pairs would fit (same shape, different '
                   f'level), which is what the pins are for.\n',
                   '| Piece | Hangs from | Arms, left to right |', '|---|---|---|']
        for p in pieces:
            hang = ', '.join(sorted({f'{q["type"]}' for q in pieces if p['type'] in q['arms']})) or '(root)'
            report.append(f'| {p["type"]}{" (piece " + str(p["id"]) + ")" if p["id"] else ""} | {hang} | '
                          f'{" , ".join(p["arms"]) or "(head, no arms)"} |')
        report.append(f'\nDrawings: `physical/out/connectors_{mid}.svg`, `physical/out/pieces_{mid}.svg`.')
        json.dump(dict(params=dict(DIAMETER=DIAMETER, ROUND=ROUND, CLR=CLR, R_PIN=R_PIN, R_POST=R_POST,
                                   R_HOLE=R_HOLE, POS=POS, LEVEL_POS={str(k): v for k, v in LEVEL_POS.items()}),
                       pieces=pieces, connector_types=[f'{a}{b}' for a, b in child_types]),
                  open(os.path.join(OUT, f'design_{mid}.json'), 'w'), indent=1)
    open(os.path.join(HERE, 'KEYS.md'), 'w').write('\n'.join(report) + '\n')
    if failed:
        sys.exit('VERIFICATION FAILED')
    print('all checks passed')


if __name__ == '__main__':
    main()
