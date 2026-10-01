#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Solution figures: the drawing from the task statement plus highlights on top.

For every entry in FIGS takes img/tN/gfx/<source>.svg, appends an overlay
(points, segments, shaded polygons, labels) and writes img/tN/sol/<id>.svg.
The solution text then shows it with
    <p class="sol-fig"><img src="img/tN/sol/<id>.svg" alt="..."></p>

Graph figures are annotated in GRID coordinates: the origin and the cell size
are read from the source SVG itself (grey grid lines, black axes), so a point
written as (4, 2) lands exactly on the node. Geometry figures have no grid and
are annotated in the SVG's own units (pt), with vertices taken from its paths.

Run from the repo root:  python3 tools/annotate_figs.py
"""
import os
import re

ACCENT = '#1d4e89'          # interface blue; warm colours are student status
HALO = '#ffffff'


def grid_of(svg):
    """Origin (pt) and cell size (pt) of a graph drawn on a square grid."""
    h = float(re.search(r'matrix\(0\.1, 0, 0, -0\.1, 0, ([\d.]+)\)', svg).group(1))
    xs, ys, ax, ay = set(), set(), None, None
    for m in re.finditer(r'<path\b[^>]*>', svg):
        tag = m.group(0)
        d = re.search(r'\sd="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) "', tag)
        if not d or 'matrix(0.1' not in tag:
            continue
        x1, y1, x2, y2 = map(float, d.groups())
        grey = 'rgb(66.6' in tag
        axis = 'rgb(0%, 0%, 0%)' in tag and 'stroke-width="10"' in tag
        if x1 == x2 and y1 != y2:
            if grey: xs.add(x1 / 10)
            if axis: ax = x1 / 10
        elif y1 == y2 and x1 != x2:
            if grey: ys.add(h - y1 / 10)
            if axis: ay = h - y1 / 10
    xs, ys = sorted(xs), sorted(ys)
    cell = (xs[-1] - xs[0]) / (len(xs) - 1)
    assert ax is not None and ay is not None, 'axes not found'
    assert abs(cell - (ys[-1] - ys[0]) / (len(ys) - 1)) < 0.01, 'grid is not square'
    return ax, ay, cell


class Fig:
    def __init__(self, src, grid=False):
        self.svg = open(src, encoding='utf-8').read()
        self.items = []
        if grid:
            self.ox, self.oy, self.cell = grid_of(self.svg)
        self.grid = grid

    def p(self, pt):
        """Grid coordinates -> SVG units (identity for geometry figures)."""
        if not self.grid:
            return pt
        return (self.ox + pt[0] * self.cell, self.oy - pt[1] * self.cell)

    def polygon(self, pts, opacity=0.16):
        s = ' '.join('%.2f,%.2f' % self.p(q) for q in pts)
        self.items.append(f'<polygon points="{s}" fill="{ACCENT}" fill-opacity="{opacity}" stroke="none"/>')

    def segment(self, a, b, width=1.3, dash=None):
        (x1, y1), (x2, y2) = self.p(a), self.p(b)
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.items.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
                          f'stroke="{ACCENT}" stroke-width="{width}" stroke-linecap="round"{d}/>')

    def point(self, a, r=2.2):
        x, y = self.p(a)
        self.items.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{ACCENT}" stroke="{HALO}" stroke-width="0.6"/>')

    def label(self, a, text, dx=0, dy=0, size=8, anchor='middle'):
        """dx, dy — offset in pt from the anchor point (y grows downward)."""
        x, y = self.p(a)
        self.items.append(
            f'<text x="{x + dx:.2f}" y="{y + dy:.2f}" font-family="Times New Roman, Times, serif" '
            f'font-size="{size}" font-weight="bold" text-anchor="{anchor}" fill="{ACCENT}" '
            f'stroke="{HALO}" stroke-width="2" stroke-linejoin="round" paint-order="stroke">{text}</text>')

    def save(self, dst, width=300):
        """width — displayed width in px; the trainer shows the file at its own size."""
        vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', self.svg).group(1).split()]
        head = re.search(r'<svg\b[^>]*>', self.svg).group(0)
        sized = re.sub(r'\swidth="[^"]+"', f' width="{width}"', head, count=1)
        sized = re.sub(r'\sheight="[^"]+"', f' height="{round(width * vb[3] / vb[2])}"', sized, count=1)
        self.svg = self.svg.replace(head, sized, 1)
        end = self.svg.rindex('</svg>')
        out = self.svg[:end] + '<g id="sol-overlay">\n' + '\n'.join(self.items) + '\n</g>\n' + self.svg[end:]
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'w', encoding='utf-8') as f:
            f.write(out)
        print('wrote', dst)


def t9_9():
    # Tangent through the grid nodes (-1; 3) and (4; 2): slope = -1/5.
    f = Fig('img/t9/gfx/derivatives-14.svg', grid=True)
    a, b, c = (-1, 3), (4, 2), (4, 3)
    f.polygon([a, b, c])
    f.segment(a, c, dash='2.5 2')
    f.segment(c, b, dash='2.5 2')
    f.label((1.5, 3), '5 клеток вправо', dy=-3.5, size=7)
    f.label((4, 2.5), '1 вниз', dx=3, dy=2.5, size=7, anchor='start')
    f.point(a); f.point(b)
    f.label(a, '(−1; 3)', dy=-5, dx=-2, size=7, anchor='end')
    f.label(b, '(4; 2)', dy=10, size=7)
    f.save('img/t9/sol/9.svg')


def t12_19():
    # Line through (1; 5); parabola through (0; 0), (1; 0), (2; 2).
    f = Fig('img/t12/gfx/plots-41.svg', grid=True)
    for pt, txt, dx, dy, anchor in [((1, 5), '(1; 5)', 4, 3, 'start'), ((2, 2), '(2; 2)', 4, 3, 'start'),
                                    ((1, 0), '(1; 0)', 4, -4, 'start'), ((0, 0), '(0; 0)', -4, -4, 'end')]:
        f.point(pt)
        f.label(pt, txt, dx=dx, dy=dy, size=7.5, anchor=anchor)
    f.save('img/t12/sol/19.svg')


def t1_68():
    # Parallelogram ABCD, E — midpoint of AD. Vertices are read from planimetry-7.svg (pt).
    A, B, C, D, E = (30.69, 63.67), (13.54, 12.21), (82.15, 12.21), (99.30, 63.67), (65.00, 63.67)
    f = Fig('img/t1/gfx/planimetry-7.svg')
    f.polygon([A, B, E], opacity=0.30)          # the triangle that is cut off
    f.polygon([E, B, D], opacity=0.12)          # its twin inside ABD
    f.segment(B, D, dash='2.5 2')               # the extra diagonal
    f.label(((A[0] + B[0] + E[0]) / 3, (A[1] + B[1] + E[1]) / 3), '6', dy=2.5, size=7.5)
    f.label(((E[0] + B[0] + D[0]) / 3, (E[1] + B[1] + D[1]) / 3), '6', dy=2.5, size=7.5)
    f.label(((B[0] + C[0] + D[0]) / 3, (B[1] + C[1] + D[1]) / 3), '12', dy=2.5, size=7.5)
    f.save('img/t1/sol/68.svg', width=240)


FIGS = [t9_9, t12_19, t1_68]

if __name__ == '__main__':
    for fn in FIGS:
        fn()
