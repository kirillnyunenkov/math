# -*- coding: utf-8 -*-
"""Solution figures for task 9. Built by tools/annotate_figs.py."""
import math

from annotate_figs import ACCENT, Fig, dots, polylines


# ---- helpers: the plotted curve is the longest polyline of the source SVG ----

def _curve(f):
    """Curve points in the figure's own coordinates (cells for grid figures, pt otherwise)."""
    pts = max(polylines(f.svg), key=lambda q: len(q['pts']))['pts']
    if f.grid:
        return [((x - f.ox) / f.cell, (f.oy - y) / f.cell) for x, y in pts]
    return pts


def _y(g, x):
    """Curve ordinate at abscissa x (linear interpolation between neighbours)."""
    for (x1, y1), (x2, y2) in zip(g, g[1:]):
        if x1 <= x <= x2:
            return y1 + (y2 - y1) * (x - x1) / ((x2 - x1) or 1)
    raise ValueError('x=%s is outside the curve' % x)


def _piece(g, x1, x2):
    """Part of the curve over [x1; x2], ends included exactly."""
    return [(x1, _y(g, x1))] + [q for q in g if x1 < q[0] < x2] + [(x2, _y(g, x2))]


def _stroke(f, pts, width, arrow=0):
    """Thick blue line along pts; arrow > 0 adds an arrowhead of that length (pt) at the end."""
    p = [f.p(q) for q in pts]
    f.raw('<polyline points="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
          'stroke-linejoin="round"/>' % (' '.join('%.2f,%.2f' % q for q in p), ACCENT, width))
    if arrow:
        (x2, y2) = p[-1]
        (x1, y1) = next(q for q in reversed(p) if math.hypot(q[0] - x2, q[1] - y2) > 3)
        a = math.atan2(y2 - y1, x2 - x1)
        tip = (x2 + arrow * 0.55 * math.cos(a), y2 + arrow * 0.55 * math.sin(a))
        w = [(x2 + arrow * 0.5 * math.cos(a + s * 2.3), y2 + arrow * 0.5 * math.sin(a + s * 2.3)) for s in (1, -1)]
        f.raw('<polygon points="%s" fill="%s"/>' % (' '.join('%.2f,%.2f' % q for q in [tip] + w), ACCENT))


def _area(f, g, x1, x2, opacity=0.2):
    """Shade the region between the curve and the x-axis over [x1; x2] (grid figures)."""
    f.polygon([(x1, 0)] + _piece(g, x1, x2) + [(x2, 0)], opacity=opacity)


def t9_1():
    # f' < 0 where the graph goes down: x3, x4, x7. No grid here, units are pt.
    f = Fig('img/t9/gfx/derivatives-53.svg')
    g = _curve(f)
    # right — how far the highlight runs past the point (the bottoms are just to the right of x4 and x7)
    for x, right, (lx, ly, anchor) in [(108.55, 9, (103, 66, 'end')), (165.58, 6, (156, 141, 'middle')),
                                       (255.62, 3.5, (257, 31, 'start'))]:
        _stroke(f, _piece(g, x - 11, x + right), 2.6, arrow=9)
        f.point((x, _y(g, x)), r=3)
        f.label((lx, ly), 'вниз', size=11.5, anchor=anchor)
    f.save('img/t9/sol/1.svg')


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


def t9_28():
    # f'(x) = 0 at tops and bottoms; inside [-7; 2] they are x = -4, -2, -1, 0, 1.
    f = Fig('img/t9/gfx/derivatives-25.svg', grid=True)
    g = _curve(f)
    for x in (-7, 2):
        f.segment((x, -5), (x, 2.7), width=1, dash='2.5 2')
    _axis_segment(f, -7, 2, width=2.2, r=2.2)
    f.label((-7, 0), '−7', dx=-2.5, dy=-3, size=7.5, anchor='end')
    f.label((2, 0), '2', dx=3, dy=-3, size=7.5, anchor='start')
    for x, up in [(-4, True), (-2, False), (-1, True), (0, False), (1, True)]:
        y = _y(g, x)
        f.segment((x - 0.45, y), (x + 0.45, y), width=1.2)
        f.point((x, y))
    f.save('img/t9/sol/28.svg')


def t9_34():
    # The only bottom of the graph: (-2; -4); the tangent there is horizontal.
    f = Fig('img/t9/gfx/derivatives-26.svg', grid=True)
    a = (-2, -4)
    f.segment((-2, 0), a, width=1, dash='2.5 2')
    f.segment((-3.3, -4), (-0.7, -4), width=1.3)
    f.point(a); f.point((-2, 0))
    f.label((-2, 0), '−2', dy=-4, size=8)
    f.label(a, '(−2; −4)', dy=10, size=7.5)
    f.save('img/t9/sol/34.svg')


def _tangent(f, g, x, half):
    """Short tangent to the curve at x; half — half-length in cells."""
    k = (_y(g, x + 0.04) - _y(g, x - 0.04)) / 0.08
    dx = half / math.hypot(1, k)
    y = _y(g, x)
    f.segment((x - dx, y - k * dx), (x + dx, y + k * dx), width=1.5)
    f.point((x, y))


def t9_40():
    # Down at -2 and 3 (f' < 0); up at 1 and 4, and steeper at 4.
    f = Fig('img/t9/gfx/derivatives-27.svg', grid=True)
    g = _curve(f)
    for x in (-2, 1, 3, 4):
        _tangent(f, g, x, 0.55)
    f.label((-2, _y(g, -2)), 'вниз', dx=5, dy=-1, size=7.5, anchor='start')
    f.label((3, _y(g, 3)), 'вниз', dx=4, dy=-3, size=7.5, anchor='start')
    f.label((1, _y(g, 1)), 'полого', dx=5, dy=9, size=7, anchor='start')
    f.label((4, _y(g, 4)), 'круче', dx=2.5, dy=9, size=7, anchor='start')
    f.save('img/t9/sol/40.svg')


def _axis_segment(f, x1, x2, width=2.4, r=2.4):
    """The given segment [x1; x2] marked on the x-axis."""
    f.segment((x1, 0), (x2, 0), width=width)
    f.point((x1, 0), r=r); f.point((x2, 0), r=r)


def t9_46():
    # Graph of f'. On [-2; 6] it crosses the axis at -1, 3, 5; only at 3 the sign goes from minus to plus (min).
    f = Fig('img/t9/gfx/derivatives-36.svg', grid=True)
    g = _curve(f)
    for x1, x2 in [(-2, -1), (-1, 3), (3, 5), (5, 6)]:
        _area(f, g, x1, x2)
    _axis_segment(f, -2, 6, width=3.4, r=3.4)
    f.label((-2, 0), '−2', dy=15, dx=-2, size=11.5)
    f.label((6, 0), '6', dy=-7, dx=2, size=11.5)
    for pt, s in [((-1.55, 0.4), '+'), ((2, -1.0), '−'), ((4, 0.4), '+'), ((5.45, -0.3), '−')]:
        f.label(pt, s, dy=4, size=14)
    for x in (-1, 3, 5):
        f.point((x, 0), r=3.4)
    f.label((3, 0), 'мин', dx=-4, dy=-6, size=11.5, anchor='end')
    f.save('img/t9/sol/46.svg')


def t9_54():
    # Graph of f'. On [-2; 3] it lies below the axis: f decreases, the least value is at x = 3.
    f = Fig('img/t9/gfx/derivatives-38.svg', grid=True)
    g = _curve(f)
    _area(f, g, -2, 3)
    _axis_segment(f, -2, 3)
    f.label((-2, 0), '−2', dy=-4, size=7.5)
    f.label((3, 0), '3', dy=-4, size=7.5)
    f.label((-1.5, -0.85), '−', dy=3, size=10)
    f.label((2, -1.5), '−', dy=3, size=10)
    f.label((1.7, 1.2), 'f убывает', size=7.5)
    f.save('img/t9/sol/54.svg')


def t9_60():
    # Graph of f'. Above the axis (f' > 0, f increases) at x2, x3, x5, x6, x9, x10. Units are pt.
    f = Fig('img/t9/gfx/derivatives-42.svg')
    g = _curve(f)
    oy = 81.89
    zeros = [x1 + (x2 - x1) * (oy - y1) / (y2 - y1) for (x1, y1), (x2, y2) in zip(g, g[1:]) if (y1 - oy) * (y2 - oy) < 0]
    for x1, x2 in zip(zeros, zeros[1:]):
        if _y(g, (x1 + x2) / 2) < oy:                     # y grows downward: this lobe is above the axis
            f.polygon([(x1, oy)] + [q for q in g if x1 < q[0] < x2] + [(x2, oy)], opacity=0.2)
    for x in (60.19, 73.76, 136.16, 185.0, 285.39, 304.39):
        f.point((x, _y(g, x)), r=3.4)
    for pt in [(51, 72), (150, 55), (296, 55)]:
        f.label(pt, '+', dy=4, size=15)
    for pt in [(10, 96), (95, 88), (236, 100)]:
        f.label(pt, '−', dy=4, size=15)
    f.save('img/t9/sol/60.svg')


def t9_68():
    # Graph of f'. On [1; 6] it crosses the axis once, at x = 4: plus on the left, minus on the right.
    f = Fig('img/t9/gfx/derivatives-47.svg', grid=True)
    g = _curve(f)
    _area(f, g, 1, 4)
    _area(f, g, 4, 6)
    _axis_segment(f, 1, 6)
    f.label((6, 0), '6', dy=-4, dx=1, size=7.5)
    f.label((2.6, 1.0), '+', dy=3, size=10)
    f.label((5.3, -0.75), '−', dy=3, size=10)
    f.point((4, 0), r=2.6)
    f.label((4, 0), 'x = 4', dx=4, dy=-5, size=7.5, anchor='start')
    f.save('img/t9/sol/68.svg')


FIGS = [t9_1, t9_9, t9_28, t9_34, t9_40, t9_46, t9_54, t9_60, t9_68]
