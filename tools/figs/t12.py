# -*- coding: utf-8 -*-
"""Solution figures for task 12. Built by tools/annotate_figs.py."""
from annotate_figs import Fig, dots, polylines


def t12_19():
    # Line through (1; 5); parabola through (0; 0), (1; 0), (2; 2).
    f = Fig('img/t12/gfx/plots-41.svg', grid=True)
    for pt, txt, dx, dy, anchor in [((1, 5), '(1; 5)', 4, 3, 'start'), ((2, 2), '(2; 2)', 4, 3, 'start'),
                                    ((1, 0), '(1; 0)', 4, -4, 'start'), ((0, 0), '(0; 0)', -4, -4, 'end')]:
        f.point(pt)
        f.label(pt, txt, dx=dx, dy=dy, size=7.5, anchor=anchor)
    f.save('img/t12/sol/19.svg')


def _mark(f, pt, text, dx, dy, anchor='start', size=7.5, r=2.2):
    """Point in a grid node plus its coordinates; dx, dy are in CELLS (y up)."""
    f.point(pt, r=r)
    f.label(pt, text, dx=dx * f.cell, dy=-dy * f.cell, size=size, anchor=anchor)


def t12_1():
    # Line through (0; -1) and (1; 1): one cell right, two cells up, k = 2.
    f = Fig('img/t12/gfx/plots-1.svg', grid=True)
    a, b, c = (0, -1), (1, 1), (0, 1)
    f.polygon([a, c, b])
    f.segment(a, c, width=1.1, dash='1.8 1.5')
    f.segment(c, b, width=0.9, dash='1.8 1.5')
    f.label((0, 0.3), '2 вверх', dx=-3, size=5, anchor='end')
    f.label((0.07, 1.22), '1 вправо', size=4.5, anchor='start')
    _mark(f, a, '(0; −1)', -0.45, -0.5, 'end', size=5, r=1.6)
    _mark(f, b, '(1; 1)', 0.25, -0.1, 'start', size=5, r=1.6)
    f.save('img/t12/sol/1.svg')


def t12_7():
    # First line: (0; 0), (1; 2), one cell right - two up. Second line: (-4; 0), (0; 4).
    f = Fig('img/t12/gfx/plots-3.svg', grid=True)
    a, b, c = (0, 0), (1, 2), (1, 0)
    f.polygon([a, c, b])
    f.segment(a, c, width=1.1, dash='2.2 1.8')
    f.segment(c, b, width=1.0, dash='2.2 1.8')
    f.label((0.75, -1.0), 'на 1 вправо', size=6)
    f.label((1.15, 1.42), 'на 2', size=6, anchor='start')
    f.label((1.15, 1.1), 'вверх', size=6, anchor='start')
    _mark(f, a, '(0; 0)', -0.15, 0.15, 'end', size=6.25, r=1.9)
    _mark(f, b, '(1; 2)', 0.17, -0.1, 'start', size=6.25, r=1.9)
    _mark(f, (-4, 0), '(−4; 0)', 0.1, -0.5, 'start', size=6.25, r=1.9)
    _mark(f, (0, 4), '(0; 4)', 0.2, -0.3, 'start', size=6.25, r=1.9)
    f.save('img/t12/sol/7.svg')


def t12_13():
    # Parabola: roots (1; 0), (2; 0) and the point (0; 2) that gives a.
    f = Fig('img/t12/gfx/plots-5.svg', grid=True)
    _mark(f, (0, 2), '(0; 2)', -0.2, -0.1, 'end', size=6.25, r=1.9)
    _mark(f, (1, 0), '(1; 0)', -0.25, -0.5, 'end', size=6.25, r=1.9)
    _mark(f, (2, 0), '(2; 0)', 0.15, -0.5, 'start', size=6.25, r=1.9)
    f.save('img/t12/sol/13.svg')


def t12_25():
    # Hyperbola through the grid node (5; 1).
    f = Fig('img/t12/gfx/plots-44.svg', grid=True)
    _mark(f, (5, 1), '(5; 1)', 0, 0.5, 'middle', size=6.25, r=1.9)
    f.save('img/t12/sol/25.svg')


def t12_33():
    # Common point A(-4; -2); the line also crosses the y axis at (0; -1).
    f = Fig('img/t12/gfx/plots-17.svg', grid=True)
    _mark(f, (-4, -2), '(−4; −2)', -0.15, -0.85, 'middle')
    _mark(f, (0, -1), '(0; −1)', -0.15, -0.8, 'end')
    f.save('img/t12/sol/33.svg')


def t12_43():
    # Square-root graph through (0; 0), (1; -3) and (4; -6).
    f = Fig('img/t12/gfx/plots-43.svg', grid=True)
    _mark(f, (0, 0), '(0; 0)', 0.2, 0.15, 'start')
    _mark(f, (1, -3), '(1; −3)', 0.25, 0.1, 'start')
    _mark(f, (4, -6), '(4; −6)', 0.2, 0.2, 'start')
    f.save('img/t12/sol/43.svg', width=235)


def t12_49():
    # Root graph through (1; 5), line through (1; 1).
    f = Fig('img/t12/gfx/plots-22.svg', grid=True)
    _mark(f, (1, 5), '(1; 5)', 0.2, 0.1, 'start')
    _mark(f, (1, 1), '(1; 1)', 0.2, -0.4, 'start')
    f.save('img/t12/sol/49.svg')


def t12_55():
    # Exponential graph through (0; 1) and (-1; 4).
    f = Fig('img/t12/gfx/plots-26.svg', grid=True)
    _mark(f, (-1, 4), '(−1; 4)', -0.2, -0.15, 'end')
    _mark(f, (0, 1), '(0; 1)', 0.2, 0.1, 'start')
    f.save('img/t12/sol/55.svg')


def t12_64():
    # Logarithm graph through (1; 0) and (2; -1).
    f = Fig('img/t12/gfx/plots-32.svg', grid=True)
    _mark(f, (1, 0), '(1; 0)', 0.15, 0.15, 'start')
    _mark(f, (2, -1), '(2; −1)', 0.15, 0.1, 'start')
    f.save('img/t12/sol/64.svg')


FIGS = [t12_1, t12_7, t12_13, t12_19, t12_25, t12_33, t12_43, t12_49, t12_55, t12_64]
