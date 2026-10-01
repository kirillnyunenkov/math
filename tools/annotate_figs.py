#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Solution figures: the drawing from the task statement plus highlights on top.

Specs live in tools/figs/tN.py (one file per task number, each with a FIGS
list of functions). Every function takes img/tN/gfx/<source>.svg, appends an overlay
(points, segments, shaded polygons, labels) and writes img/tN/sol/<id>.svg.
The solution text then shows it with
    <p class="sol-fig"><img src="img/tN/sol/<id>.svg" alt="..."></p>

Graph figures are annotated in GRID coordinates: the origin and the cell size
are read from the source SVG itself (grey grid lines, black axes), so a point
written as (4, 2) lands exactly on the node. Geometry figures have no grid and
are annotated in the SVG's own units (pt), with vertices taken from its paths.

Run from the repo root:  python3 tools/annotate_figs.py        # all
                         python3 tools/annotate_figs.py t9     # one task
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

    def polygon(self, pts, opacity=0.22):
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

    def raw(self, svg_fragment):
        """Anything the helpers do not cover (arcs, right-angle marks); units are pt."""
        self.items.append(svg_fragment)

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


def dots(svg_text):
    """Marked points of a geometry drawing (zero-length round strokes), in pt."""
    h = float(re.search(r'matrix\(0\.1, 0, 0, -0\.1, 0, ([\d.]+)\)', svg_text).group(1))
    out = []
    for m in re.finditer(r'\sd="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) "', svg_text):
        x1, y1, x2, y2 = map(float, m.groups())
        if x1 == x2 and y1 == y2:
            out.append((round(x1 / 10, 2), round(h - y1 / 10, 2)))
    return out


def polylines(svg_text):
    """Every stroked path as a list of points in pt (straight segments only)."""
    h = float(re.search(r'matrix\(0\.1, 0, 0, -0\.1, 0, ([\d.]+)\)', svg_text).group(1))
    out = []
    for m in re.finditer(r'<path\b[^>]*>', svg_text):
        tag = m.group(0)
        if 'matrix(0.1' not in tag:
            continue
        d = re.search(r'\sd="([^"]+)"', tag).group(1)
        pts = [(round(float(x) / 10, 2), round(h - float(y) / 10, 2)) for x, y in re.findall(r'[ML] ([\d.]+) ([\d.]+)', d)]
        if len(pts) > 1 and pts[0] != pts[-1] or len(pts) > 2:
            out.append({'pts': pts, 'dashed': 'stroke-dasharray' in tag, 'closed': ' Z' in d,
                        'width': float(re.search(r'stroke-width="([\d.]+)"', tag).group(1)) if 'stroke-width' in tag else 0})
    return out


if __name__ == '__main__':
    import glob
    import importlib.util
    import sys
    sys.modules['annotate_figs'] = sys.modules['__main__']   # specs do `from annotate_figs import Fig`
    only = set(sys.argv[1:])           # e.g. "t9" to rebuild one task only
    for path in sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'figs', 't*.py'))):
        name = os.path.splitext(os.path.basename(path))[0]
        if only and name not in only:
            continue
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for fn in mod.FIGS:
            fn()
