# -*- coding: utf-8 -*-
"""Solution figures for task 1. Built by tools/annotate_figs.py."""
from annotate_figs import Fig, dots, polylines


def t1_68():
    # Parallelogram ABCD, E — midpoint of AD. Vertices are read from planimetry-7.svg (pt).
    A, B, C, D, E = (30.69, 63.67), (13.54, 12.21), (82.15, 12.21), (99.30, 63.67), (65.00, 63.67)
    f = Fig('img/t1/gfx/planimetry-7.svg')
    f.polygon([A, B, E], opacity=0.38)          # the triangle that is cut off
    f.polygon([E, B, D], opacity=0.20)          # its twin inside ABD
    f.segment(B, D, dash='2.5 2')               # the extra diagonal
    f.label(((A[0] + B[0] + E[0]) / 3, (A[1] + B[1] + E[1]) / 3), '6', dy=2.5, size=7.5)
    f.label(((E[0] + B[0] + D[0]) / 3, (E[1] + B[1] + D[1]) / 3), '6', dy=2.5, size=7.5)
    f.label(((B[0] + C[0] + D[0]) / 3, (B[1] + C[1] + D[1]) / 3), '12', dy=2.5, size=7.5)
    f.save('img/t1/sol/68.svg', width=240)


FIGS = [t1_68]
