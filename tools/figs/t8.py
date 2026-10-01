# -*- coding: utf-8 -*-
"""Solution figures for task 8: the unit circle shows why the sign is what it is.
Built by tools/annotate_figs.py."""
import math
from annotate_figs import Fig, ACCENT, INK


def unit_circle(dst, quarter, sin_a, cos_a, sin_text, cos_text):
    assert abs(sin_a ** 2 + cos_a ** 2 - 1) < 1e-9
    f = Fig.blank(170, 160)
    cx, cy, r = 85, 82, 56
    P = lambda c, s: (cx + r * c, cy - r * s)
    a0 = (quarter - 1) * 90
    arc = [P(math.cos(math.radians(a0 + t)), math.sin(math.radians(a0 + t))) for t in range(0, 91, 3)]
    f.polygon([(cx, cy)] + arc, opacity=0.2)
    f.circle((cx, cy), r, width=1.1)
    f.segment((cx - r - 14, cy), (cx + r + 16, cy), color=INK, width=0.9)
    f.segment((cx, cy + r + 14), (cx, cy - r - 16), color=INK, width=0.9)
    f.raw(f'<path d="M {cx + r + 11} {cy - 2.5} L {cx + r + 16} {cy} L {cx + r + 11} {cy + 2.5}" fill="none" stroke="{INK}" stroke-width="0.9"/>')
    f.raw(f'<path d="M {cx - 2.5} {cy - r - 11} L {cx} {cy - r - 16} L {cx + 2.5} {cy - r - 11}" fill="none" stroke="{INK}" stroke-width="0.9"/>')
    f.label((cx + r + 16, cy), 'cos', dy=10, size=7.5, color=INK, bold=False, anchor='end')
    f.label((cx, cy - r - 16), 'sin', dx=5, dy=6, size=7.5, color=INK, bold=False, anchor='start')
    pt = P(cos_a, sin_a)
    f.segment((cx, cy), pt, width=1.2)
    f.segment(pt, (pt[0], cy), dash='2.5 2', width=0.9)
    f.segment(pt, (cx, pt[1]), dash='2.5 2', width=0.9)
    f.segment((cx, cy), (pt[0], cy), width=2.2)
    f.segment((cx, cy), (cx, pt[1]), width=2.2)
    f.point(pt)
    sx = 1 if cos_a > 0 else -1
    f.label(((cx + pt[0]) / 2, cy), cos_text, dy=11, size=7.5)
    f.label((cx, (cy + pt[1]) / 2), sin_text, dx=-4 * sx, dy=2.5, size=7.5, anchor='end' if sx > 0 else 'start')
    f.label(pt, 'α', dx=6 * sx, dy=-4, size=9, anchor='start' if sx > 0 else 'end')
    names = {1: 'I четверть', 2: 'II четверть'}
    f.label((cx + sx * r * 0.72, cy - r * 0.86), names[quarter], dx=sx * 4, dy=-6, size=7,
            anchor='start' if sx > 0 else 'end', color=INK, bold=False)
    f.save(dst)


def t8_122():
    s = math.sqrt(26) / 26
    c = 5 / math.sqrt(26)
    assert abs(s / c - 0.2) < 1e-12
    unit_circle('img/t8/sol/122.svg', 1, s, c, 'sin α &gt; 0', 'cos α &gt; 0')


def t8_128():
    c = -math.sqrt(21) / 5
    s = 0.4
    unit_circle('img/t8/sol/128.svg', 2, s, c, 'sin α &gt; 0', 'cos α &lt; 0')


FIGS = [t8_122, t8_128]
