# -*- coding: utf-8 -*-
"""Solution figures for task 2. Built by tools/annotate_figs.py."""
from annotate_figs import Fig, dots, polylines


def _ends(f, pts, size, r):
    """Start and end of each vector with coordinate labels: (point, text, dx, dy, anchor)."""
    for pt, txt, dx, dy, anchor in pts:
        f.point(pt, r=r)
        f.label(pt, txt, dx=dx, dy=dy, size=size, anchor=anchor)


def t2_14():
    # a: (1; 1) -> (4; 5), i.e. 3 right and 4 up; b: (3; 3) -> (5; 2), i.e. 2 right and 1 down.
    f = Fig('img/t2/gfx/vectors-1.svg', grid=True)
    dash, w, size = '1.6 1.3', 0.75, 4.8
    f.segment((1, 1), (1, 5), width=w, dash=dash)
    f.segment((1, 5), (4, 5), width=w, dash=dash)
    f.label((1, 4.2), '4 вверх', dx=1.5, size=size, anchor='start')
    f.label((2.4, 5), '3 вправо', dy=-2, size=size)
    f.segment((3, 3), (3, 2), width=w, dash=dash)
    f.segment((3, 2), (5, 2), width=w, dash=dash)
    f.label((3, 2), '1 вниз', dx=-1, dy=5.5, size=size, anchor='end')
    f.label((4.1, 2), '2 вправо', dy=5.5, size=size)
    _ends(f, [((1, 1), '(1; 1)', 2, 6, 'start'), ((4, 5), '(4; 5)', 2.5, 1, 'start'),
              ((3, 3), '(3; 3)', 1, -2.5, 'start'), ((5, 2), '(5; 2)', -1, -3.5, 'start')], size=size, r=1.3)
    f.save('img/t2/sol/14.svg', width=240)


def t2_44():
    # a: (1; 2) -> (5; 8), i.e. 4 right and 6 up; b: (5; 5) -> (11; 3), i.e. 6 right and 2 down.
    f = Fig('img/t2/gfx/vectors-6.svg', grid=True)
    dash, w, size = '2 1.6', 0.9, 6
    f.segment((1, 2), (1, 8), width=w, dash=dash)
    f.segment((1, 8), (5, 8), width=w, dash=dash)
    f.label((1, 6.6), '6 вверх', dx=2, size=size, anchor='start')
    f.label((3, 8), '4 вправо', dy=-2.5, size=size)
    f.segment((5, 5), (5, 3), width=w, dash=dash)
    f.segment((5, 3), (11, 3), width=w, dash=dash)
    f.label((5, 3.9), '2 вниз', dx=-2, size=size, anchor='end')
    f.label((7.8, 3), '6 вправо', dy=7, size=size)
    _ends(f, [((1, 2), '(1; 2)', 2, 7, 'start'), ((5, 8), '(5; 8)', 3, 1, 'start'),
              ((5, 5), '(5; 5)', 2, -3, 'start'), ((11, 3), '(11; 3)', 10, 7, 'end')], size=size, r=1.6)
    f.save('img/t2/sol/44.svg', width=300)


FIGS = [t2_14, t2_44]
