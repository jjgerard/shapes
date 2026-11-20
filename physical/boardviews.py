#!/usr/bin/env python3
"""
What the kit looks like on a whiteboard: the game's own sentences with their real words, silent heads (a blank magnet with a null sign)
and traces (the word crossed out), laid out by whiteboard.py from the checked tile outlines, sticks and word magnets.
Run from the repo root:  python3 physical/boardviews.py
"""
import json, os, sys
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon as MPoly, Circle
from shapely.affinity import translate

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import spokes as sp
import whiteboard as W
import concept as K

OUT = os.path.join(HERE, 'out')
WORDS = json.load(open(os.path.join(HERE, 'words.json')))


def to_tree(node, mode):
    star = '*' if (node['n'] == 2 and mode == 'prex') else ''
    t = dict(t=f"{node['s']}{node['n']}{star}", c=[to_tree(c, mode) for c in node['c']])
    if not node['c']:
        t['winfo'] = (node['w'], node['silent'], node['trace'])
    return t


def abbreviate(tree, target, size, words):
    """Replace the first subtree of type `target` by an abbreviation triangle holding `words`."""
    def go(n):
        for i, c in enumerate(n['c']):
            if c['t'] == target:
                n['c'][i] = {'t': f'ABBR:{size}', 'c': [], 'words': words, 'slot_type': target}
                return True
            if go(c): return True
        return False
    go(tree)
    return tree


def draw(ax, lay, cats, title):
    for (a, b) in lay['sticks']:
        ax.plot([a[0], b[0]], [a[1], b[1]], color='#4b5563', lw=4.0, solid_capstyle='butt', zorder=1)
        for q in (a, b):
            ax.add_patch(Circle(q, 3.0, fc='#c7ccd3', ec='#4b5563', lw=1.0, zorder=3))
            ax.add_patch(Circle((q[0] - .9, q[1] - .9), 0.9, fc='white', ec='none', zorder=4, alpha=.8))
    def magnet(cx, y0, text, trace=False):
        ww = W.word_w(text)
        ax.add_patch(FancyBboxPatch((cx - ww / 2, y0), ww, W.WORD_H, boxstyle='round,pad=0,rounding_size=1.5', fc='#f4ecd8' if not trace else '#ece6d6', ec='#8a8372', lw=0.9, zorder=2))
        ax.text(cx, y0 + W.WORD_H / 2 + 0.2, text, ha='center', va='center', fontsize=8, color='#111827' if not trace else '#6b7280', zorder=5, family='serif')
        if trace:
            ax.plot([cx - ww / 2 + 2, cx + ww / 2 - 2], [y0 + W.WORD_H / 2, y0 + W.WORD_H / 2], color='#b91c1c', lw=1.1, zorder=6)
    for ty, x, y, nn in lay['tiles']:
        if ty.startswith('ABBR'):
            pts = np.array(nn['poly'].exterior.coords) + np.array([x, y])
            ax.add_patch(MPoly(pts, closed=True, fc='#d1d5db', ec='#1f2937', lw=1.1, zorder=2, joinstyle='round'))
            ws = nn.get('words') or []
            tot = W.abbr_row(nn); cx0 = x - tot / 2; y0 = y + nn['poly'].bounds[3] + 2.0
            for w_ in ws:
                ww = W.word_w(w_); magnet(cx0 + ww / 2, y0, w_); cx0 += ww + 4.0
            continue
        shape, col, r, kind = K.node_info(ty, cats)
        pts = np.array(nn['poly'].exterior.coords) + np.array([x, y])
        ax.add_patch(MPoly(pts, closed=True, fc=col, ec='#1f2937', lw=1.1, zorder=2, joinstyle='round'))
        ax.text(x, y + (2.5 if shape == 'triangle' else 0), K.label(ty), ha='center', va='center', fontsize=7.5 if r < 12 else 9, color='white', fontweight='bold', zorder=5)
        if not nn['c'] and nn.get('word'):
            magnet(x, y + nn['poly'].bounds[3] + 2.0, nn['word'], nn.get('trace', False))
    ax.set_aspect('equal'); ax.invert_yaxis(); ax.axis('off')
    ax.set_title(title, fontsize=11, loc='left', color='#374151')


def board(lays, titles, path, cats, widths=None):
    n = len(lays)
    ext = []
    for lay in lays:
        xs, ys = [], []
        for ty, x, y, nn in lay['tiles']:
            b = W.tile_clear(nn).bounds
            xs += [x + b[0], x + b[2]]; ys += [y + b[1], y + b[3]]
        ext.append((min(xs), max(xs), min(ys), max(ys)))
    W_ = [e[1] - e[0] + 70 for e in ext]
    H_ = max(e[3] - e[2] for e in ext) + 90
    scale = 0.052
    fig, axes = plt.subplots(1, n, figsize=(max(sum(W_) * scale + 0.6, 6), H_ * scale + 0.9), facecolor='#d1d5db', gridspec_kw=dict(width_ratios=W_))
    for ax, lay, title, e in zip(np.atleast_1d(axes), lays, titles, ext):
        ax.set_facecolor('#f7f8f6')
        draw(ax, lay, cats, title)
        ax.set_xlim(e[0] - 35, e[1] + 35); ax.set_ylim(e[2] + H_ - 45, e[2] - 40)
        ax.add_patch(FancyBboxPatch((e[0] - 35, e[2] - 40), e[1] - e[0] + 70, H_ - 5, boxstyle='round,pad=0,rounding_size=6', fc='#f7f8f6', ec='#9aa3ad', lw=2.5, zorder=-5))
    fig.tight_layout(pad=0.6); fig.savefig(path, dpi=110, facecolor=fig.get_facecolor()); plt.close(fig)


def main():
    cats, modes = sp.load()
    W.CATS = cats
    L = W.CHOSEN
    def lay_of(key, mutate=None):
        t = to_tree(WORDS[key], key.split(':')[0])
        if mutate: t = mutate(t)
        t = W.prep(t)
        lay = W.layout(t, L, W.ANGLES)
        assert lay, key
        assert not W.verify(lay), key
        return lay
    a = lay_of('prex:L2 the-fluffy-cat-will-jump')
    b = lay_of('prex:L2 the-fluffy-cat-will-jump', lambda t: abbreviate(t, 'N1', 'large', ['the', 'fluffy', 'cat']))
    board([a, b], ['"the fluffy cat will jump", every node built', 'the same sentence with the subject abbreviated'], os.path.join(OUT, 'board_fluffy.png'), cats)
    c = lay_of('xbar:L2 the-cat-chased-the-mouse')
    d = lay_of('xbar:L2 did-the-cat-chase-the-mouse')
    board([c, d], ['"the cat chased the mouse" (T is silent: a magnet with a null sign)', '"did the cat chase the mouse" (the crossed-out "did" is the trace left in T)'], os.path.join(OUT, 'board_xbar_pair.png'), cats)
    e = lay_of('xbar:L2 which-mouse-did-the-cat-chase')
    board([e], ['"which mouse did the cat chase" (traces crossed out)'], os.path.join(OUT, 'board_which.png'), cats)
    f = lay_of('prex:L2 the-fluffy-cat-quickly-jumped-on-the-table')
    board([f], ['"the fluffy cat quickly jumped on the table"'], os.path.join(OUT, 'board_table.png'), cats)
    print('done')


if __name__ == '__main__':
    main()
