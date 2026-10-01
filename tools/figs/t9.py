# -*- coding: utf-8 -*-
"""Solution figures for task 9. Built by tools/annotate_figs.py."""
from annotate_figs import Fig, dots, polylines


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


FIGS = [t9_9]
