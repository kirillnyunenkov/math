# -*- coding: utf-8 -*-
"""Solution figures for task 3 (stereometry). Built by tools/annotate_figs.py.

Polyhedra are vector drawings: vertices are read from polylines() (pt).
Round bodies are raster images inside the SVG: centres, axes and extreme
points were measured on the embedded bitmap (8 px per pt).
"""
import math

from annotate_figs import Fig, ACCENT, HALO

GFX = 'img/t3/gfx/stereometry-%d.svg'
DASH = '2.5 2'


def it(s):
    return f'<tspan font-style="italic">{s}</tspan>'


def mid(a, b, t=0.5):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def edges(f, solid=(), dashed=(), width=1.2):
    """Outline: visible edges solid, hidden ones stay dashed."""
    for a, b in dashed:
        f.segment(a, b, width=1.0, dash=DASH)
    for a, b in solid:
        f.segment(a, b, width=width)


def ellipse(f, c, rx, ry, opacity=0.22):
    f.raw(f'<ellipse cx="{c[0]:.2f}" cy="{c[1]:.2f}" rx="{rx:.2f}" ry="{ry:.2f}" '
          f'fill="{ACCENT}" fill-opacity="{opacity}" stroke="none"/>')


def right_angle(f, o, u, v, s=3.2):
    """Small square at o; u and v are unit directions of the two legs."""
    a = (o[0] + u[0] * s, o[1] + u[1] * s)
    b = (a[0] + v[0] * s, a[1] + v[1] * s)
    c = (o[0] + v[0] * s, o[1] + v[1] * s)
    f.raw(f'<polyline points="{a[0]:.2f},{a[1]:.2f} {b[0]:.2f},{b[1]:.2f} {c[0]:.2f},{c[1]:.2f}" '
          f'fill="none" stroke="{ACCENT}" stroke-width="0.7"/>')


def rlabel(f, a, text, angle, size=7):
    """Label rotated by `angle` degrees around its anchor point."""
    f.raw(f'<text x="{a[0]:.2f}" y="{a[1]:.2f}" transform="rotate({angle:.1f} {a[0]:.2f} {a[1]:.2f})" '
          f'font-family="Times New Roman, Times, serif" font-size="{size}" font-weight="bold" '
          f'text-anchor="middle" fill="{ACCENT}" stroke="{HALO}" stroke-width="2" '
          f'stroke-linejoin="round" paint-order="stroke">{text}</text>')


# ---------- polyhedra ----------

# stereometry-1 / -2 / -12: the same box, letters A..D (bottom), A1..D1 (top).
BOX = dict(A=(15.39, 61.53), B=(73.46, 69.83), C=(98.35, 53.23), D=(40.28, 44.94),
           A1=(15.39, 28.34), B1=(73.46, 36.64), C1=(98.35, 20.05), D1=(40.28, 11.75))


def t3_1():
    # Prism ABCA1B1C1 inside the box; AB = 8, BC = 7, AA1 = 6.
    A, B, C, A1, B1, C1 = (BOX[k] for k in ('A', 'B', 'C', 'A1', 'B1', 'C1'))
    f = Fig(GFX % 1)
    f.polygon([A, B, C, C1, A1], opacity=0.12)
    f.polygon([A, B, C], opacity=0.26)
    edges(f, solid=[(A, B), (B, C), (A, A1), (B, B1), (C, C1), (A1, B1), (B1, C1), (A1, C1)],
          dashed=[(A, C)])
    f.label(mid(A, B), '8', dx=-2, dy=8, size=7.5)
    f.label(mid(B, C), '7', dx=4, dy=7, size=7.5)
    f.label(mid(A, A1), '6', dx=-3.5, dy=2.5, size=7.5, anchor='end')
    f.save('img/t3/sol/1.svg', width=260)


def t3_7():
    # Prism with bases AA1D and BB1C ("lying on its side"); AB = 5, BC = 4, BB1 = AA1 = 3.
    A, B, C, D, A1, B1 = (BOX[k] for k in ('A', 'B', 'C', 'D', 'A1', 'B1'))
    f = Fig(GFX % 2)
    f.polygon([A, B, C, B1, A1], opacity=0.12)
    f.polygon([B, B1, C], opacity=0.28)
    edges(f, solid=[(A, B), (B, C), (B, B1), (B1, C), (A1, B1), (A, A1)],
          dashed=[(A, D), (D, C), (A1, D)])
    f.label(mid(A, B), '5', dx=-2, dy=8, size=7.5)
    f.label(mid(B, C), '4', dx=4, dy=7, size=7.5)
    f.label(mid(B, B1), '3', dx=-3, dy=9, size=7.5, anchor='end')
    f.save('img/t3/sol/7.svg', width=260)


def t3_13():
    # Cube; M, N — midpoints of BC and CD; the cut-off prism is CMNC1M1N1.
    C, C1 = (98.35, 69.59), (98.35, 20.96)
    M, M1 = (79.91, 78.81), (79.91, 30.18)
    N, N1 = (75.30, 64.98), (75.30, 16.36)
    f = Fig(GFX % 3)
    f.polygon([N1, C1, C, M, N], opacity=0.12)
    f.polygon([C, M, N], opacity=0.28)
    edges(f, solid=[(M, C), (C, C1), (M, M1), (M1, C1), (C1, N1), (N1, M1)],
          dashed=[(M, N), (N, C), (N, N1)])
    f.label(mid(C, C1), it('a'), dx=4, dy=2.5, size=7.5, anchor='start')
    f.label(mid(M, C), it('a') + '/2', dx=6, dy=14, size=6.5, anchor='start')
    f.label(mid(N, C), it('a') + '/2', dx=1.5, dy=-3, size=6.5)
    f.save('img/t3/sol/13.svg', width=260)


def quarter_base(f, A, B, C, M, N):
    """Base ABC split by its three midlines into four equal triangles; AMN is shaded."""
    K = mid(B, C)
    f.polygon([A, B, C], opacity=0.10)
    f.polygon([A, M, N], opacity=0.30)
    f.segment(M, K, width=0.9, dash=DASH)
    f.segment(N, K, width=0.9, dash=DASH)
    f.segment(M, N, width=1.0, dash=DASH)


def t3_20():
    # Oblique prism, MN — midline of the base; the cut-off prism is AMNA1M1N1 (volume).
    A, B, C = (10.92, 85.50), (67.61, 61.20), (83.81, 85.50)
    A1 = (25.46, 36.05)
    M, N, M1, N1 = (47.36, 85.50), (39.27, 73.35), (61.90, 36.05), (53.80, 23.90)
    f = Fig(GFX % 4)
    f.polygon([A, M, M1, N1, A1], opacity=0.10)
    quarter_base(f, A, B, C, M, N)
    edges(f, solid=[(A, M), (M, M1), (A, A1), (A1, M1), (A1, N1), (N1, M1)],
          dashed=[(A, N), (N, N1)])
    f.save('img/t3/sol/20.svg', width=260)


def t3_38():
    # Right prism, MN — midline of the base; the cut-off prism is AMNA1M1N1 (volume).
    A, B, C = (15.39, 103.14), (70.22, 66.58), (97.63, 103.14)
    A1 = (15.39, 48.30)
    M, N, M1, N1 = (56.51, 103.14), (42.80, 84.86), (56.51, 48.30), (42.80, 30.03)
    f = Fig(GFX % 5)
    f.polygon([A, M, M1, N1, A1], opacity=0.10)
    quarter_base(f, A, B, C, M, N)
    edges(f, solid=[(A, M), (M, M1), (A, A1), (A1, M1), (A1, N1), (N1, M1)],
          dashed=[(A, N), (N, N1)])
    f.save('img/t3/sol/38.svg', width=250)


def lateral_faces(dst):
    # Oblique prism: lateral faces of the cut-off prism against the faces of the whole prism.
    A, B, C = (10.92, 85.50), (67.61, 61.20), (83.81, 85.50)
    A1 = (25.46, 36.05)
    M, N, M1, N1 = (47.36, 85.50), (39.27, 73.35), (61.90, 36.05), (53.80, 23.90)
    f = Fig(GFX % 4)
    f.polygon([A, A1, M1, M], opacity=0.26)      # half of the face AA1C1C
    f.polygon([A, A1, N1, N], opacity=0.10)      # half of the face AA1B1B
    f.polygon([M, M1, N1, N], opacity=0.10)      # against the face CC1B1B
    edges(f, solid=[(A, M), (M, M1), (A, A1), (A1, M1), (A1, N1), (N1, M1)],
          dashed=[(A, N), (N, N1), (M, N), (C, B)])
    f.save(dst, width=260)


def t3_27():
    lateral_faces('img/t3/sol/27.svg')


def t3_35():
    lateral_faces('img/t3/sol/35.svg')


def t3_46():
    # Prism with C front-left, A right, B behind; pyramid ABCC1: S(ABC) = 6, CC1 = 9.
    C, C1, A, B = (15.04, 103.14), (15.04, 46.02), (95.00, 80.29), (26.46, 68.87)
    f = Fig(GFX % 6)
    f.polygon([C, A, C1], opacity=0.12)
    f.polygon([C, A, B], opacity=0.26)
    edges(f, solid=[(C, A), (C1, A)], dashed=[(C, B), (B, A), (C1, B)])
    f.segment(C, C1, width=1.8)
    f.label(mid(C, C1), '9', dx=-3.5, dy=2.5, size=7.5, anchor='end')
    f.label((48, 87), it('S') + ' = 6', size=7.5)
    f.save('img/t3/sol/46.svg', width=250)


def t3_52():
    # Prism with A front-left, B right, C behind; the cut-off pyramid A1ABC: S(ABC) = 4, AA1 = 6.
    A, A1, B, C = (15.39, 103.14), (15.39, 46.02), (95.35, 80.29), (26.81, 68.87)
    f = Fig(GFX % 8)
    f.polygon([A, B, A1], opacity=0.12)
    f.polygon([A, B, C], opacity=0.26)
    edges(f, solid=[(A, B), (A1, B)], dashed=[(A, C), (C, B), (A1, C)])
    f.segment(A, A1, width=1.8)
    f.label(mid(A, A1), '6', dx=-3.5, dy=2.5, size=7.5, anchor='end')
    f.label((48, 87), it('S') + ' = 4', size=7.5)
    f.save('img/t3/sol/52.svg', width=250)


def t3_58():
    # Box with B front-left, C front, D right, A behind; pyramid A1ABCD: AB = 3, AD = 9, AA1 = 4.
    B, C, D, A, A1 = (15.47, 60.80), (72.70, 68.98), (97.22, 52.63), (40.00, 44.45), (40.00, 11.75)
    f = Fig(GFX % 21)
    f.polygon([B, C, D, A1], opacity=0.10)
    f.polygon([A, B, C, D], opacity=0.24)
    edges(f, solid=[(B, C), (C, D)], dashed=[(A, B), (A, D), (A1, B), (A1, C), (A1, D)])
    f.segment(A, A1, width=1.6, dash='3 1.6')
    f.label(mid(A, A1), '4', dx=5.5, dy=14, size=7.5)
    f.label(mid(A, B), '3', dx=5, dy=8, size=7.5)
    f.label(mid(A, D), '9', dx=14, dy=10.5, size=7.5)
    f.save('img/t3/sol/58.svg', width=260)


def t3_64():
    # Pyramid ABCB1 inside the box; AB = 9, BC = 6, BB1 = AA1 = 5.
    A, B, C, B1 = (BOX[k] for k in ('A', 'B', 'C', 'B1'))
    f = Fig(GFX % 12)
    f.polygon([A, B, C, B1], opacity=0.12)
    f.polygon([A, B, C], opacity=0.26)
    edges(f, solid=[(A, B), (B, C), (A, B1), (B1, C)], dashed=[(A, C)])
    f.segment(B, B1, width=1.8)
    f.label(mid(A, B), '9', dx=-2, dy=8, size=7.5)
    f.label(mid(B, C), '6', dx=4, dy=7, size=7.5)
    f.label(mid(B, B1), '5', dx=4.5, dy=-5.5, size=7.5)
    f.save('img/t3/sol/64.svg', width=260)


# ---------- round bodies (raster drawings) ----------

def two_cylinders(dst, r1, h1, r2, h2):
    # Left cylinder: axis x = 19.5, bases at y = 7.4 and 58.2, right side x = 36.8.
    # Right cylinder: axis x = 80.0, bases at y = 41.3 and 57.7, right side x = 114.45.
    f = Fig(GFX % 13)
    t1, b1, e1 = (19.5, 7.4), (19.5, 58.2), (36.8, 58.2)
    t2, b2, e2 = (80.0, 41.3), (80.0, 57.7), (114.45, 57.7)
    for t, b, e in ((t1, b1, e1), (t2, b2, e2)):
        f.segment(t, b, width=1.0, dash=DASH)
        f.segment(b, e, width=1.0, dash=DASH)
        f.point(b, r=1.4)
    f.label(mid(t1, b1), h1, dx=-3, dy=2.5, size=7.5, anchor='end')
    f.label(mid(b1, e1), r1, dy=-2.5, size=7.5)
    f.label(t2, h2, dx=-3, dy=7.5, size=7.5, anchor='end')
    f.label(mid(b2, e2), r2, dy=7, size=7.5)
    f.save(dst, width=270)


def t3_70():
    two_cylinders('img/t3/sol/70.svg', it('r'), it('h'), '1,5' + it('r'), it('h') + '/2')


def t3_76():
    two_cylinders('img/t3/sol/76.svg', it('R'), it('h'), '2' + it('R'), it('h') + '/3')


def t3_82():
    # Cone: apex (52.9; 2.3), base centre (52.9; 98.5), base runs from x = 2.2 to 103.6.
    P, O, L, R = (52.9, 2.3), (52.9, 98.5), (2.2, 98.5), (103.6, 98.5)
    Q = (52.9, O[1] - (O[1] - P[1]) / 9)          # apex of the new cone, height h/9
    f = Fig(GFX % 14)
    f.polygon([L, Q, R], opacity=0.24)
    f.segment(L, Q, width=1.0)
    f.segment(Q, R, width=1.0)
    f.segment(P, O, width=1.0, dash=DASH)
    f.segment(O, R, width=1.0, dash=DASH)
    f.point(Q, r=1.5)
    f.label(mid(P, O), it('h'), dx=-3.5, dy=2.5, size=8, anchor='end')
    f.label(mid(O, R), it('R'), dy=8, size=8)
    f.label(Q, it('h') + '/9', dx=4, dy=-2.5, size=8, anchor='start')
    f.save('img/t3/sol/82.svg', width=230)


def t3_88():
    # Cone-shaped vessel: apex (52.9; 114.9), rim centre (52.9; 18.5), rim radius 51;
    # liquid surface centre (52.9; 82.5), its radius 17 (one third).
    P, O, R = (52.9, 114.9), (52.9, 18.5), (103.6, 18.5)
    o, r = (52.9, 82.5), (69.9, 82.5)
    f = Fig(GFX % 19)
    f.segment(O, o, width=1.0, dash=DASH)
    f.segment(O, R, width=1.0, dash=DASH)
    f.segment(o, r, width=1.3)
    f.label(mid(O, o), it('h'), dx=4, dy=2.5, size=8, anchor='start')
    f.label(mid(O, R), it('R'), dy=8, size=8)
    f.label(r, it('R') + '/3', dx=5, dy=2.5, size=8, anchor='start')
    # dimension line for the height of the liquid
    x = 24
    f.segment((x, o[1]), (x, P[1]), width=1.0)
    f.segment((x - 2, o[1]), (35.0, o[1]), width=0.6)
    f.segment((x - 2, P[1]), (51.5, P[1]), width=0.6)
    f.label((x, (o[1] + P[1]) / 2), it('h') + '/3', dx=-3, dy=2.5, size=8, anchor='end')
    f.save('img/t3/sol/88.svg', width=230)


def cyl_cone_triangle(dst):
    # Cylinder with a cone inside, h = R: apex (58.4; 20.3), base centre (58.4; 72.9), right end x = 114.1.
    P, O, R = (58.4, 20.3), (58.4, 72.9), (114.1, 72.9)
    f = Fig(GFX % 15)
    f.polygon([P, O, R], opacity=0.20)
    f.segment(P, O, width=1.2, dash=DASH)
    f.segment(O, R, width=1.2, dash=DASH)
    f.segment(P, R, width=1.2, dash=DASH)
    right_angle(f, O, (1, 0), (0, -1))
    f.label(mid(P, O), it('h') + ' = ' + it('R'), dx=-3, dy=6, size=7.5, anchor='end')
    f.label(mid(O, R), it('R'), dy=8, size=7.5)
    f.label(mid(P, R), it('l'), dx=4.5, dy=-2, size=8)
    f.save(dst, width=260)


def t3_94():
    cyl_cone_triangle('img/t3/sol/94.svg')


def t3_100():
    cyl_cone_triangle('img/t3/sol/100.svg')


def cyl_cone_volume(dst):
    # Tall cylinder with a cone: apex (46.9; 16.7), base centre (46.9; 100.5), semi-axes 44.4 and 14.6.
    P, O = (46.9, 16.7), (46.9, 100.5)
    L, R = (2.5, 100.5), (91.25, 100.5)
    f = Fig(GFX % 16)
    ellipse(f, O, 44.4, 14.6, opacity=0.24)
    f.polygon([L, P, R], opacity=0.10)
    f.segment(P, O, width=1.2, dash=DASH)
    f.label(mid(P, O), it('h'), dx=4, dy=2.5, size=8, anchor='start')
    f.label((62, 110), it('S'), size=8)
    f.save(dst, width=215)


def t3_106():
    cyl_cone_volume('img/t3/sol/106.svg')


def t3_112():
    cyl_cone_volume('img/t3/sol/112.svg')


def t3_118():
    # Cylinder (r = 2, h = 2) inscribed in a box. Bottom face of the box: left (2.3; 55.2),
    # near (67.0; 64.7), right (115.4; 52.0), far (50.8; 42.5); its centre is the marked dot.
    Lf, Nr, Rt, Fr = (2.3, 55.2), (67.0, 64.7), (115.4, 52.0), (50.8, 42.5)
    O = mid(Lf, Rt)
    T1, T2 = mid(Fr, Lf), mid(Nr, Rt)             # tangent points: a diameter parallel to the edge Lf–Nr
    NrTop = (67.0, 24.5)
    f = Fig(GFX % 23)
    f.segment(T1, T2, width=1.1, dash=DASH)
    f.segment(Lf, Nr, width=1.5)
    f.segment(Nr, NrTop, width=1.5)
    f.point(O, r=1.4)
    f.label(mid(T1, O), '2', dx=-1, dy=-2.5, size=7.5)
    f.label(mid(O, T2), '2', dx=1, dy=-2.5, size=7.5)
    f.label(mid(Lf, Nr), '4', dx=-3, dy=8, size=7.5)
    f.label(mid(Nr, NrTop), '2', dx=4.5, dy=-7, size=7.5)
    f.save('img/t3/sol/118.svg', width=270)


def sphere_in_cylinder(dst):
    # Sphere centre (46.9; 58.5); it touches the bases at (46.9; 16.7) and (46.9; 100.5), the side at x = 91.2.
    O, T, B, R = (46.9, 58.5), (46.9, 16.7), (46.9, 100.5), (91.2, 58.5)
    f = Fig(GFX % 17)
    f.segment(T, B, width=1.2, dash=DASH)
    f.segment(O, R, width=1.2, dash=DASH)
    f.point(T, r=1.5); f.point(B, r=1.5)
    f.label(mid(O, T), it('R'), dx=-3.5, dy=2.5, size=8, anchor='end')
    f.label(mid(O, B), it('R'), dx=-3.5, dy=6, size=8, anchor='end')
    f.label(mid(O, R), it('R'), dx=2, dy=-2.5, size=8)
    f.save(dst, width=215)


def t3_124():
    sphere_in_cylinder('img/t3/sol/124.svg')


def t3_130():
    sphere_in_cylinder('img/t3/sol/130.svg')


def t3_136():
    sphere_in_cylinder('img/t3/sol/136.svg')


def cone_in_sphere(dst, slant=None, radius=None):
    # Sphere centre = centre of the cone base (58.4; 55.5); apex (58.4; 2.6); right end of the base (114.3; 55.5).
    O, P, R = (58.4, 55.5), (58.4, 2.6), (114.3, 55.5)
    f = Fig(GFX % (20 if slant else 18))
    if slant:
        f.polygon([P, O, R], opacity=0.18)
        f.segment(P, R, width=1.2, dash=DASH)
    f.segment(P, O, width=1.2, dash=DASH)
    f.segment(O, R, width=1.2, dash=DASH)
    right_angle(f, O, (1, 0), (0, -1))
    f.label(mid(P, O), it('h') + ' = ' + it('R'), dx=-3, dy=5, size=7.5, anchor='end')
    f.label(mid(O, R), radius or it('R'), dy=8, size=7.5)
    if slant:
        ang = math.degrees(math.atan2(R[1] - P[1], R[0] - P[0]))
        m = mid(P, R)
        rlabel(f, (m[0] + 3.2, m[1] - 3.4), slant, ang, size=7.5)
    f.save(dst, width=260)


def t3_142():
    cone_in_sphere('img/t3/sol/142.svg')


def t3_148():
    cone_in_sphere('img/t3/sol/148.svg')


def t3_154():
    cone_in_sphere('img/t3/sol/154.svg', slant=it('l') + ' = 9√2')


def t3_160():
    cone_in_sphere('img/t3/sol/160.svg', slant=it('l'), radius=it('R') + ' = 84√2')


def t3_166():
    # Sphere: centre (58.4; 55.5); the great-circle section is an ellipse with semi-axes 56.2 and 17.3.
    O, R = (58.4, 55.5), (114.3, 55.5)
    f = Fig(GFX % 22)
    ellipse(f, O, 56.2, 17.3, opacity=0.22)
    f.segment(O, R, width=1.3, dash=DASH)
    f.label(mid(O, R), it('R'), dy=8, size=8)
    f.label((33, 52), 'π' + it('R') + '² = 12', size=8)
    f.save('img/t3/sol/166.svg', width=260)


FIGS = [t3_1, t3_7, t3_13, t3_20, t3_27, t3_35, t3_38, t3_46, t3_52, t3_58, t3_64,
        t3_70, t3_76, t3_82, t3_88, t3_94, t3_100, t3_106, t3_112, t3_118,
        t3_124, t3_130, t3_136, t3_142, t3_148, t3_154, t3_160, t3_166]
