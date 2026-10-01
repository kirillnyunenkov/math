# -*- coding: utf-8 -*-
"""Solution figures for task 1. Built by tools/annotate_figs.py."""
import math

from annotate_figs import ACCENT, Fig, dots, polylines

GFX = 'img/t1/gfx/planimetry-%d.svg'


# ---------- helpers (geometry figures, units are pt of the source SVG) ----------

def _dots(n):
    """Marked points of planimetry-<n>.svg, in the order they appear in the file."""
    return dots(open(GFX % n, encoding='utf-8').read())


def _unit(a, b):
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    return ((b[0] - a[0]) / d, (b[1] - a[1]) / d)


def _at(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _lab(f, p, text, size=7, dx=0, dy=0, halo=None):
    """Label centred (also vertically) on point p. halo — thinner white outline for tight spots."""
    if halo is None:
        f.label(p, text, dx=dx, dy=dy + size * 0.34, size=size)
    else:
        f.raw(f'<text x="{p[0] + dx:.2f}" y="{p[1] + dy + size * 0.34:.2f}" font-family="Times New Roman, Times, serif" '
              f'font-size="{size}" font-weight="bold" text-anchor="middle" fill="{ACCENT}" stroke="#ffffff" '
              f'stroke-width="{halo}" stroke-linejoin="round" paint-order="stroke">{text}</text>')


def _side(f, a, b, text, off, t=0.5, size=7):
    """Label next to segment ab: at parameter t, shifted by off pt along the normal."""
    u = _unit(a, b)
    q = _at(a, b, t)
    _lab(f, (q[0] + u[1] * off, q[1] - u[0] * off), text, size)


def _angle(f, v, p, q, r=7, text=None, lr=None, size=6.5, width=0.9, halo=None):
    """Arc of the angle pvq (the one smaller than 180) and, optionally, its value on the bisector."""
    u1, u2 = _unit(v, p), _unit(v, q)
    if r:
        sweep = 1 if u1[0] * u2[1] - u1[1] * u2[0] > 0 else 0
        f.raw(f'<path d="M {v[0] + r * u1[0]:.2f} {v[1] + r * u1[1]:.2f} A {r} {r} 0 0 {sweep} '
              f'{v[0] + r * u2[0]:.2f} {v[1] + r * u2[1]:.2f}" fill="none" stroke="{ACCENT}" stroke-width="{width}"/>')
    if text:
        bx, by = u1[0] + u2[0], u1[1] + u2[1]
        d = math.hypot(bx, by)
        _lab(f, (v[0] + lr * bx / d, v[1] + lr * by / d), text, size, halo=halo)


def _right(f, v, p, q, s=5):
    """Right-angle mark at v between rays vp and vq."""
    u1, u2 = _unit(v, p), _unit(v, q)
    a = (v[0] + s * u1[0], v[1] + s * u1[1])
    b = (a[0] + s * u2[0], a[1] + s * u2[1])
    c = (v[0] + s * u2[0], v[1] + s * u2[1])
    f.raw(f'<path d="M {a[0]:.2f} {a[1]:.2f} L {b[0]:.2f} {b[1]:.2f} L {c[0]:.2f} {c[1]:.2f}" '
          f'fill="none" stroke="{ACCENT}" stroke-width="0.9"/>')


def _tick(f, a, b, t=0.5, h=2.6):
    """Equal-segments tick across ab (in the middle unless t is given)."""
    u = _unit(a, b)
    m = _at(a, b, t)
    f.segment((m[0] + u[1] * h, m[1] - u[0] * h), (m[0] - u[1] * h, m[1] + u[0] * h), width=1.0)


def _circ_arc(f, o, p, q, width=1.9):
    """The smaller arc pq of the circle with centre o, drawn over the circle."""
    r = math.hypot(p[0] - o[0], p[1] - o[1])
    u1, u2 = _unit(o, p), _unit(o, q)
    sweep = 1 if u1[0] * u2[1] - u1[1] * u2[0] > 0 else 0
    f.raw(f'<path d="M {p[0]:.2f} {p[1]:.2f} A {r:.2f} {r:.2f} 0 0 {sweep} {q[0]:.2f} {q[1]:.2f}" '
          f'fill="none" stroke="{ACCENT}" stroke-width="{width}" stroke-linecap="round"/>')


def _centroid(*pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


# ---------- figures ----------

def _right_triangle(dst, leg, hyp, given, found):
    # planimetry-1: right triangle, C — right angle. leg — the leg the ratio needs ('AC' or 'BC').
    A, B, C = _dots(1)
    f = Fig(GFX % 1)
    if leg == 'AC':
        f.segment(A, C, width=1.8)
        _lab(f, _at(A, C, 0.5), found, dx=7)
        _lab(f, _at(C, B, 0.5), given, dy=7)
    else:
        f.segment(C, B, width=1.8)
        _lab(f, _at(C, B, 0.5), found, dy=7)
        _lab(f, _at(A, C, 0.5), given, dx=11)
    _side(f, A, B, hyp, 7)
    _angle(f, A, C, B, r=13)
    f.save(dst, width=215)


def t1_1():
    _right_triangle('img/t1/sol/1.svg', 'AC', '10', '√19', '9')


def t1_7():
    _right_triangle('img/t1/sol/7.svg', 'BC', '10', '√51', '7')


def t1_13():
    # planimetry-2: triangle ABC with the midline DE.
    A, B, C, D, E = _dots(2)
    f = Fig(GFX % 2)
    f.polygon([A, B, E, D], opacity=0.38)        # the trapezoid that is asked for
    f.polygon([C, D, E], opacity=0.16)           # the small similar triangle
    _lab(f, _centroid(C, D, E), '15', 7.5, dy=1.5)
    _lab(f, _centroid(A, B, E, D), '45', 7.5, dx=4)
    f.save('img/t1/sol/13.svg', width=260)


def t1_19():
    A, B, C, D, E = _dots(2)
    f = Fig(GFX % 2)
    f.polygon([A, B, C], opacity=0.12)           # the whole triangle
    f.polygon([C, D, E], opacity=0.34)           # its quarter
    _lab(f, _centroid(C, D, E), '6', 7.5, dy=1.5)
    f.save('img/t1/sol/19.svg', width=260)


def t1_25():
    # planimetry-19: triangle ABC, AD — bisector. ADB is the exterior angle of triangle ACD.
    A, B, C, D = _dots(19)
    f = Fig(GFX % 19)
    f.polygon([A, C, D], opacity=0.16)
    _angle(f, A, B, D, r=0, text='23°', lr=31)
    _angle(f, A, D, C, r=0, text='23°', lr=33)
    _angle(f, C, A, D, r=8, text='54°', lr=19)
    _angle(f, D, A, B, r=7, text='77°', lr=16)
    f.save('img/t1/sol/25.svg', width=260)


def t1_31():
    # planimetry-16: right triangle, CH — altitude, CM — median.
    A, B, C, H, M = _dots(16)
    f = Fig(GFX % 16)
    f.polygon([C, M, B], opacity=0.14)           # the isosceles triangle cut off by the median
    _tick(f, A, M)
    _tick(f, M, B)
    _tick(f, C, M, t=0.74)
    _angle(f, B, C, M, r=5)
    _lab(f, (B[0] + 6.5, B[1] - 7), '65°', 6.5)
    _angle(f, C, M, H, r=10)
    _lab(f, (77.2, 31.5), '40°', 6.5, halo=1.2)
    _angle(f, C, H, B, r=13)
    _lab(f, (98.0, 25.5), '25°', 6.5)             # the angle is too narrow, the value stands next to its arc
    f.save('img/t1/sol/31.svg', width=270)


def t1_38():
    # planimetry-3: right triangle, CD — bisector, CM — median.
    A, B, C, D, M = _dots(3)
    f = Fig(GFX % 3)
    f.polygon([C, M, B], opacity=0.14)
    _tick(f, M, B, t=0.25)
    _tick(f, C, M, t=0.83)
    _angle(f, B, C, M, r=14, text='21°', lr=22)
    _angle(f, C, M, B, r=21, text='21°', lr=36)
    _angle(f, C, D, M, r=15, text='24°', lr=27.5, size=6, halo=1.2)
    f.save('img/t1/sol/38.svg', width=270)


def t1_44():
    # planimetry-18: right triangle, CH — altitude, CD — bisector.
    A, B, C, D, H = _dots(18)
    f = Fig(GFX % 18)
    _angle(f, B, C, A, r=16, text='25°', lr=25)
    _angle(f, C, H, D, r=17, text='20°', lr=24.5, size=5.6, halo=0.8)
    _angle(f, C, D, B, r=13, text='45°', lr=22)
    _angle(f, C, H, B, r=31)
    _lab(f, (61.0, 36.5), '65°', 6.5)             # whole angle HCB, the value stands at the end of the big arc
    f.save('img/t1/sol/44.svg', width=270)


def t1_50():
    # planimetry-4: triangle ABC, altitudes AE (to BC) and BD (to AC).
    A, B, C, D, E = _dots(4)
    f = Fig(GFX % 4)
    f.segment(B, C, width=1.8)                   # the pair where everything is known
    f.segment(A, E, width=1.8)
    _lab(f, (93.5, 58.5), 'BC = 18', 6.5)
    _side(f, A, E, '10', 6, t=0.78)
    _lab(f, (15.5, 31.0), 'AC = 15', 6.5)
    _side(f, B, D, '12', 6, t=0.45)
    f.save('img/t1/sol/50.svg', width=260)


def t1_56():
    # planimetry-5: isosceles triangle ABC (AC = BC), exterior angle CBD.
    A, B, C, D = _dots(5)
    f = Fig(GFX % 5)
    _angle(f, B, D, C, r=9.5, text='107°', lr=19)
    _angle(f, B, A, C, r=7, text='73°', lr=16)
    _angle(f, A, B, C, r=7, text='73°', lr=16)
    _angle(f, C, A, B, r=9, text='34°', lr=23)
    f.save('img/t1/sol/56.svg', width=260)


def t1_62():
    # planimetry-6: triangle ABC inscribed in a circle with centre O; side AB lies opposite angle C.
    A, B, C, O = _dots(6)
    f = Fig(GFX % 6)
    f.segment(A, B, width=1.8)
    f.segment(O, B, dash='2.5 2')
    _angle(f, C, A, B, r=6, text='135°', lr=13)
    _side(f, A, B, '3√2', -7, t=0.42)
    _side(f, O, B, 'R = 3', -7)
    f.save('img/t1/sol/62.svg', width=260)


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


def t1_74():
    # Same drawing as t1_68; the triangle ABE itself is asked for.
    A, B, C, D, E = (30.69, 63.67), (13.54, 12.21), (82.15, 12.21), (99.30, 63.67), (65.00, 63.67)
    f = Fig(GFX % 7)
    f.polygon([A, B, E], opacity=0.38)
    f.polygon([E, B, D], opacity=0.20)
    f.segment(B, D, dash='2.5 2')
    f.label(_centroid(A, B, E), '15', dy=2.5, size=7.5)
    f.label(_centroid(E, B, D), '15', dy=2.5, size=7.5)
    f.label(_centroid(B, C, D), '30', dy=2.5, size=7.5)
    f.save('img/t1/sol/74.svg', width=240)


def t1_80():
    # planimetry-8: parallelogram ABCD, altitudes BH (to AD) and BK (to CD).
    A, B, C, D, H, K = _dots(8)
    f = Fig(GFX % 8)
    f.segment(C, D, width=1.8)                   # the pair where everything is known
    f.segment(B, K, width=1.8)
    _side(f, C, D, '18', -7, t=0.3)
    _side(f, B, K, '10', 6)
    _lab(f, (27.5, 63.3), 'AD = 20', 6.5)
    _side(f, B, H, '9', 5, t=0.6)
    f.save('img/t1/sol/80.svg', width=260)


def t1_86():
    # planimetry-15: trapezoid with a diagonal and the midline; no letters on the drawing.
    P, Q, R, S, M, N, X = _dots(15)              # bottom-left, top-left, top-right, bottom-right, midline ends, crossing
    f = Fig(GFX % 15)
    f.polygon([P, Q, S], opacity=0.12)
    f.polygon([Q, R, S], opacity=0.28)
    f.segment(M, X, width=1.9)
    f.segment(P, S, width=1.9)
    _lab(f, _at(P, S, 0.45), '10', dy=-6.5)
    _lab(f, _at(Q, R, 0.55), '4', dy=6.5)
    _lab(f, _at(M, X, 0.5), '5', dy=-5.5)
    _lab(f, _at(X, N, 0.5), '2', dy=-5.5)
    f.save('img/t1/sol/86.svg', width=270)


def _central_inscribed(dst):
    # planimetry-9: inscribed angle ACB and central angle AOB on the same arc AB.
    A, B, C, O = _dots(9)
    f = Fig(GFX % 9)
    _circ_arc(f, O, A, B)
    _angle(f, C, A, B, r=14, text='x', lr=25, size=8)
    _angle(f, O, A, B, r=9)
    _lab(f, (62.5, 77), '2x', 8)
    f.save(dst, width=250)


def t1_92():
    _central_inscribed('img/t1/sol/92.svg')


def t1_98():
    _central_inscribed('img/t1/sol/98.svg')


def _two_diameters(dst, base, apex):
    # planimetry-10: diameters AC and BD; triangle BOC is isosceles, angle AOD is vertical to BOC.
    A, B, C, D, O = _dots(10)
    f = Fig(GFX % 10)
    f.polygon([B, O, C], opacity=0.16)
    _tick(f, O, B)
    _tick(f, O, C, t=0.3)
    _angle(f, C, O, B, r=12, text=base, lr=25)
    _angle(f, B, O, C, r=12, text=base, lr=21)
    _angle(f, O, B, C, r=6, text=apex, lr=13)
    _angle(f, O, A, D, r=19, text=apex, lr=27)
    f.save(dst, width=255)


def t1_104():
    _two_diameters('img/t1/sol/104.svg', '41°', '98°')


def t1_110():
    _two_diameters('img/t1/sol/110.svg', '82°', '16°')


def _inscribed_quad(dst, cad, abd):
    # planimetry-11: inscribed quadrilateral with diagonals; angles CAD and CBD stand on the same arc CD.
    A, B, C, D = _dots(11)
    ax, ay, bx, by, cx, cy = *A, *B, *C
    # circumcentre of A, B, C — needed to draw the arc CD over the circle
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    O = (((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / d,
         ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / d)
    f = Fig(GFX % 11)
    _circ_arc(f, O, C, D)
    _angle(f, A, C, D, r=14, text=cad, lr=24)
    _angle(f, B, C, D, r=14, text=cad, lr=24)
    _angle(f, B, A, D, r=9, text=abd, lr=19)
    f.save(dst, width=255)


def t1_116():
    _inscribed_quad('img/t1/sol/116.svg', '42°', '61°')


def t1_122():
    _inscribed_quad('img/t1/sol/122.svg', '37°', '61°')


def t1_128():
    _inscribed_quad('img/t1/sol/128.svg', '77°', '43°')


def t1_134():
    # planimetry-12: inscribed quadrilateral. Given neighbours 59 and 102 are put at D and A,
    # so that the order of the four values matches the order of the drawn angles.
    A, B, C, D = _dots(12)
    f = Fig(GFX % 12)
    _angle(f, D, A, C, r=9, text='59°', lr=19)
    _angle(f, A, B, D, r=7, text='102°', lr=17)
    _angle(f, B, A, C, r=7, text='121°', lr=17)
    _angle(f, C, B, D, r=8, text='78°', lr=18)
    f.save('img/t1/sol/134.svg', width=255)


def t1_140():
    A, B, C, D = _dots(12)
    f = Fig(GFX % 12)
    _angle(f, A, B, D, r=7, text='136°', lr=17)
    _angle(f, C, B, D, r=8, text='44°', lr=18)
    f.save('img/t1/sol/140.svg', width=255)


def _tangent(dst, at_o, at_c):
    # planimetry-13: tangent CA, radius OA to the tangency point, right triangle OAC.
    O, A, B, C = _dots(13)
    f = Fig(GFX % 13)
    f.polygon([O, A, C], opacity=0.14)
    _circ_arc(f, O, A, B)
    _right(f, A, O, C)
    _angle(f, O, A, B, r=8, text=at_o, lr=17)
    _angle(f, C, A, O, r=13, text=at_c, lr=20.5)
    f.save(dst, width=260)


def t1_146():
    _tangent('img/t1/sol/146.svg', '66°', '24°')


def t1_152():
    _tangent('img/t1/sol/152.svg', '33°', '57°')


def _circumscribed_quad(dst, ab, cd, bc=None, ad=None):
    # planimetry-14: quadrilateral with an inscribed circle; AB and CD are opposite sides.
    O, A, B, C, D = _dots(14)
    f = Fig(GFX % 14)
    f.segment(A, B, width=1.8)
    f.segment(C, D, width=1.8)
    _side(f, A, B, ab, -7)
    _side(f, C, D, cd, -7)
    if bc:
        _side(f, B, C, bc, -7)
    if ad:
        _side(f, D, A, ad, -7)
    f.save(dst, width=240)


def t1_158():
    _circumscribed_quad('img/t1/sol/158.svg', '10', '17')


def t1_166():
    _circumscribed_quad('img/t1/sol/166.svg', '8', '3')


def t1_172():
    _circumscribed_quad('img/t1/sol/172.svg', '6', '9', bc='4', ad='11')


FIGS = [t1_1, t1_7, t1_13, t1_19, t1_25, t1_31, t1_38, t1_44, t1_50, t1_56, t1_62, t1_68, t1_74, t1_80, t1_86,
        t1_92, t1_98, t1_104, t1_116, t1_122, t1_128, t1_134, t1_140, t1_146, t1_152, t1_158,
        t1_172]
# t1_110 and t1_166 are kept but not built: the shared drawing contradicts their numbers
# (a 16° angle drawn obtuse; the side labelled 3 is the longest one), so labels would confuse.
