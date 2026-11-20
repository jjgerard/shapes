#!/usr/bin/env python3
"""
An assembled tree, built from the real meshes: the real body of every piece (`body/`), the sliding arm's real
stacks set to the positions the layout test chose, the plug inserts, and the fixed posts. Unused arms are left
off, as the design says. Renders two views.

Run from the repo root:  python3 physical/assemble.py [tree name ...]
"""
import math, os, sys
import numpy as np
import trimesh
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arms as A
import hinge as H
import spokes as sp
import slide as S
import body as B
import arm_options as O

BODY_DIR = os.path.join(HERE, 'body')
OUT = os.path.join(HERE, 'out')
SLOTS = {'L': 0, 'M': 1, 'U': 1, 'R': 2}


def fname(t): return t.replace('*', 'x')


def mix(hexcol, f):
    c = np.array([int(hexcol[i:i + 2], 16) for i in (1, 3, 5)], float) / 255
    return np.clip(c * f + (1 - f) * 0.0, 0, 1) if f <= 1 else np.clip(c + (1 - c) * (f - 1), 0, 1)


def body_color(t, cats):
    letter = sp.split_type(t)[0]
    col = cats[letter]['color']
    level = sp.split_type(t)[1]
    return mix(col, 1.0 if level in (1, 2) else 1.0)


def render_color(mesh, fcol, w=1100, h=800, elev=22.0, azim=-62.0, ss=1, zoom=0.92):
    W, Hh = w * ss, h * ss
    e, a = math.radians(elev), math.radians(azim)
    cam = np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
    right = np.cross([0, 0, 1], cam); right /= np.linalg.norm(right)
    up = np.cross(cam, right)
    V = mesh.vertices - mesh.bounds.mean(axis=0)
    sx, sy, dz = V @ right, V @ up, V @ cam
    scale = zoom * min(W / (sx.max() - sx.min()), Hh / (sy.max() - sy.min()))
    px = W / 2 + sx * scale
    py = Hh / 2 - sy * scale
    light = np.array([0.35, -0.45, 0.82]); light /= np.linalg.norm(light)
    lam = np.clip(mesh.face_normals @ light, 0, 1) * 0.62 + 0.38
    facing = mesh.face_normals @ cam
    img = np.ones((Hh, W, 3)); zbuf = np.full((Hh, W), -1e9)
    for fi, (i0, i1, i2) in enumerate(mesh.faces):
        if facing[fi] <= 0: continue
        xs = px[[i0, i1, i2]]; ys = py[[i0, i1, i2]]; zs = dz[[i0, i1, i2]]
        x0, x1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, W - 1)
        y0, y1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, Hh - 1)
        if x1 < x0 or y1 < y0: continue
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-12: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        z = l0 * zs[0] + l1 * zs[1] + l2 * zs[2]
        sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        upd = inside & (z > zbuf[sl])
        zbuf[sl] = np.where(upd, z, zbuf[sl])
        img[sl][upd] = fcol[fi] * lam[fi]
    return img.reshape(Hh // ss, ss, W // ss, ss, 3).mean(axis=(1, 3))


def assemble(name, parts, cats, P):
    """Returns (mesh, face_colors) for the finished tree in the tree frame (x right, y down), z toward the viewer."""
    bodies = {i[1]: (g, i[0]) for k, g, i in parts if k == 'body'}
    arms = [(g, i) for k, g, i in parts if k == 'arm']
    meshes, colors = [], []
    def add(m, col):
        meshes.append(m); colors.append(np.tile(np.asarray(col, float), (len(m.faces), 1)))
    ARM_COL = {'A': '#7a8fa6', 'S1': '#3f9c8f', 'S2': '#e08a3c', 'ins': '#24304a'}
    hexrgb = lambda hx: np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)], float) / 255
    for uid, (g, t) in bodies.items():
        n = len(sp.PORTS.get(t, {}))
        minx, miny, maxx, maxy = g.bounds
        cx, ytop = (minx + maxx) / 2, miny
        m = trimesh.load(os.path.join(BODY_DIR, f'body_{fname(t)}.stl'))
        m.apply_translation([cx, ytop + A.BODY_H, 0])
        add(m, body_color(t, cats))
        slot_letters = [k for k, v in sorted(sp.PORTS.get(t, {}).items(), key=lambda kv: sp.SLOT_ORDER[kv[0]])]
        for ag, (st, tt, slot, puid, cuid) in arms:
            if puid != uid: continue
            letter = slot_letters[slot]
            ins = trimesh.load(os.path.join(BODY_DIR, f'insert_{fname(t)}_{letter}.stl'))
            if letter in ('L', 'R') and n >= 2:
                d = abs(st.dx)
                s1, s2 = (0, 0) if d < 1 else ((S.STEP, 0) if d < 50 else (S.STEP, S.STEP))
                ms = S.assembly(P + [ins], s1, s2, letter == 'L', x0=B.arm_x0(n))
                for mm, k in zip(ms, ['A', 'S1', 'S2', 'ins']):
                    mm.apply_translation([cx, ytop + A.BODY_H, 0])
                    add(mm, hexrgb(ARM_COL[k]))
            else:                                              # a fixed post's insert
                ins.apply_translation([-S.FOOT_X, 0, S.ZC]); ins.apply_translation([cx, ytop + A.BODY_H, 0])
                add(ins, hexrgb(ARM_COL['ins']))
    mesh = trimesh.util.concatenate(meshes)
    fc = np.vstack(colors)
    return mesh, fc


def main():
    names = sys.argv[1:] or ['prex:L2 the-fluffy-cat-will-jump']
    cats, modes = sp.load()
    uniq = O.unique_trees()
    P = [S.part_A(), S.part_S1(), S.part_S2()]
    A.SLIDE_DROP, A.SLIDE_BEAM, A.SLIDE_STEM = S.DROP, S.Y_S2_BOT, S.FOOT_W
    A.BEAM_FN = S.telescope_beam(S.FOOT_X, 8.0, S.Y_S2_BOT)
    res, _ = A.evaluate(uniq, S.slide_design(), 40.0)
    for name in names:
        parts = next(p for n, o, p in res if n == name)
        mesh, fc = assemble(name, parts, cats, P)
        v = mesh.copy(); v.apply_transform(H.rot_x(-90))         # y down -> z down: the tree hangs, z up on screen
        print(name, len(v.faces), 'faces', np.ptp(v.bounds, axis=0).round(0), 'mm')
        fig, axes = plt.subplots(1, 2, figsize=(17, 7.4), facecolor='white', gridspec_kw=dict(width_ratios=[1, 1]))
        axes[0].imshow(render_color(v, fc, 900, 760, elev=4, azim=-90)); axes[0].axis('off'); axes[0].set_title('from the front', loc='left')
        axes[1].imshow(render_color(v, fc, 900, 760, elev=24, azim=-58)); axes[1].axis('off'); axes[1].set_title('from the side and above', loc='left')
        fig.tight_layout(rect=(0, 0, 1, 0.95))
        fig.suptitle(f'{name}: assembled from the real parts (unused arms left off)', fontsize=12, y=0.99)
        path = os.path.join(OUT, 'assembled_' + name.replace(':', '_').replace(' ', '_') + '.png')
        fig.savefig(path, dpi=100); plt.close(fig)
        print(path)


if __name__ == '__main__':
    main()
