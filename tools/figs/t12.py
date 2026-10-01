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


FIGS = [t12_19]
