# -*- coding: utf-8 -*-
"""Solution figures for task 5 (probability). Drawn from scratch: the statements have no drawings.
Built by tools/annotate_figs.py."""
from annotate_figs import Fig, ACCENT, INK


def _tree(dst, p_bad, p_rej_bad, p_rej_good, prod_bad, prod_good, total):
    """Two-level tree, drawn top-down (the owner's convention for probability trees):
    faulty / fine battery, then rejected / passed. Rejected branches are highlighted."""
    f = Fig.blank(260, 150)
    root, bad, good = (130, 16), (71, 62), (189, 62)
    ends = {'bb': (38, 112), 'bp': (104, 112), 'gb': (156, 112), 'gp': (222, 112)}
    c = lambda x: str(x).replace('.', ',')
    q_bad = round(1 - p_bad, 4)
    assert abs(p_bad * p_rej_bad - prod_bad) < 1e-12 and abs(q_bad * p_rej_good - prod_good) < 1e-12
    assert abs(prod_bad + prod_good - total) < 1e-12
    f.segment(root, bad, width=1.6)
    f.segment(root, good, width=1.6)
    f.segment(bad, ends['bb'], width=1.6)
    f.segment(bad, ends['bp'], color=INK, width=0.9)
    f.segment(good, ends['gb'], width=1.6)
    f.segment(good, ends['gp'], color=INK, width=0.9)
    for pt in (root, bad, good):
        f.point(pt, r=1.8)
    f.label(root, 'батарейка', dy=-5, size=7, color=INK, bold=False)
    # edge probabilities: outside the tree on the left and right, between the branches in the middle
    f.label((100, 39), c(p_bad), dx=-4, dy=0, size=7.5, anchor='end')
    f.label((160, 39), c(q_bad), dx=4, dy=0, size=7.5, anchor='start')
    f.label((54, 87), c(p_rej_bad), dx=-4, dy=2, size=7.5, anchor='end')
    f.label((88, 87), c(round(1 - p_rej_bad, 4)), dx=4, dy=2, size=7.5, color=INK, bold=False, anchor='start')
    f.label((172, 87), c(p_rej_good), dx=-4, dy=2, size=7.5, anchor='end')
    f.label((206, 87), c(round(1 - p_rej_good, 4)), dx=4, dy=2, size=7.5, color=INK, bold=False, anchor='start')
    # node names
    f.label(bad, 'неисправна', dx=-5, dy=-3, size=7, color=INK, bold=False, anchor='end')
    f.label(good, 'исправна', dx=5, dy=-3, size=7, color=INK, bold=False, anchor='start')
    for k, name in (('bb', 'забракована'), ('bp', 'пропущена'), ('gb', 'забракована'), ('gp', 'пропущена')):
        hot = k in ('bb', 'gb')
        f.label(ends[k], name, dy=10, size=7, color=ACCENT if hot else INK, bold=hot)
    # products along the highlighted branches
    f.label(ends['bb'], f'{c(p_bad)} · {c(p_rej_bad)} = {c(prod_bad)}', dy=20, size=6.5)
    f.label(ends['gb'], f'{c(q_bad)} · {c(p_rej_good)} = {c(prod_good)}', dy=20, size=6.5)
    f.save(dst, width=320)


def t5_50():
    _tree('img/t5/sol/50.svg', 0.2, 0.95, 0.05, 0.19, 0.04, 0.23)


def t5_51():
    _tree('img/t5/sol/51.svg', 0.01, 0.96, 0.06, 0.0096, 0.0594, 0.069)


def t5_44():
    # Euler circles: coffee ran out in machine 1 / machine 2; overlap 0.18.
    assert abs(0.2 - 0.18 - 0.02) < 1e-12 and abs(1 - (0.02 + 0.18 + 0.02) - 0.78) < 1e-12
    f = Fig.blank(230, 138)
    f.raw(f'<rect x="4" y="18" width="222" height="100" rx="6" fill="none" stroke="{INK}" stroke-width="1"/>')
    a, b, r = (93, 68), (137, 68), 38
    f.circle(a, r, opacity=0.14, width=1.2)
    f.circle(b, r, opacity=0.14, width=1.2)
    f.label((115, 68), '0,18', dy=3, size=9)
    f.label((70, 68), '0,02', dy=3, size=8, color=INK, bold=False)
    f.label((160, 68), '0,02', dy=3, size=8, color=INK, bold=False)
    f.label((93, 12), 'кончился в 1-м: 0,2', size=7.5, color=INK, bold=False)
    f.label((137, 132), 'кончился во 2-м: 0,2', size=7.5, color=INK, bold=False)
    f.segment((93, 15), (88, 30), color=INK, width=0.6)
    f.segment((137, 122), (142, 106), color=INK, width=0.6)
    f.label((200, 34), '0,78', dy=0, size=9)
    f.label((200, 43), 'остался', size=6.5)
    f.label((200, 50), 'в обоих', size=6.5)
    f.save('img/t5/sol/44.svg', width=300)


def t5_32():
    # Mass axis with two thresholds: three zones 0.18 | 0.78 | 0.04.
    assert abs(1 - 0.82 - 0.18) < 1e-12 and abs(1 - 0.96 - 0.04) < 1e-12 and abs(1 - 0.18 - 0.04 - 0.78) < 1e-12
    f = Fig.blank(240, 70)
    y, x0, x1, xa, xb = 40, 8, 232, 78, 162
    f.polygon([(xa, y - 9), (xb, y - 9), (xb, y + 9), (xa, y + 9)], opacity=0.25)
    f.segment((x0, y), (x1, y), color=INK, width=1.1)
    f.raw(f'<path d="M {x1 - 6} {y - 3} L {x1} {y} L {x1 - 6} {y + 3}" fill="none" stroke="{INK}" stroke-width="1.1"/>')
    for x, t in ((xa, '790 г'), (xb, '810 г')):
        f.segment((x, y - 11), (x, y + 11), color=INK, width=1.1)
        f.label((x, y + 22), t, size=8, color=INK, bold=False)
    f.label(((x0 + xa) / 2, y - 14), '0,18', size=8.5, color=INK, bold=False)
    f.label(((xa + xb) / 2, y - 14), '0,78', size=9.5)
    f.label(((xb + x1) / 2, y - 14), '0,04', size=8.5, color=INK, bold=False)
    f.label(((x0 + xa) / 2, y + 22), 'лёгкая', size=7, color=INK, bold=False)
    f.label(((xb + x1) / 2, y + 22), 'тяжёлая', size=7, color=INK, bold=False)
    f.save('img/t5/sol/32.svg', width=300)


def t5_26():
    # 6 x 6 outcomes of two dice; row and column "6" are excluded, sum 8 is marked.
    f = Fig.blank(150, 150)
    o, c = 26, 19
    cell = lambda i, j: (o + (i - 1) * c, o + (j - 1) * c)          # top-left corner of (first=i, second=j)
    ok = [(i, j) for i in range(1, 6) for j in range(1, 6) if i + j == 8]
    lost = [(i, j) for i in range(1, 7) for j in range(1, 7) if i + j == 8 and 6 in (i, j)]
    assert ok == [(3, 5), (4, 4), (5, 3)] and lost == [(2, 6), (6, 2)]
    # excluded row and column
    x6, y6 = cell(6, 6)
    f.polygon([(x6, o), (x6 + c, o), (x6 + c, o + 6 * c), (x6, o + 6 * c)], opacity=0.28, color=INK)
    f.polygon([(o, y6), (o + 5 * c, y6), (o + 5 * c, y6 + c), (o, y6 + c)], opacity=0.28, color=INK)
    for i, j in ok:
        x, y = cell(i, j)
        f.polygon([(x, y), (x + c, y), (x + c, y + c), (x, y + c)], opacity=0.45)
    for k in range(7):
        f.segment((o + k * c, o), (o + k * c, o + 6 * c), color=INK, width=0.6)
        f.segment((o, o + k * c), (o + 6 * c, o + k * c), color=INK, width=0.6)
    for k in range(1, 7):
        f.label((o + (k - 0.5) * c, o - 5), str(k), size=8, color=INK, bold=False)
        f.label((o - 8, o + (k - 0.5) * c + 3), str(k), size=8, color=INK, bold=False)
    for i, j in ok + lost:
        x, y = cell(i, j)
        f.label((x + c / 2, y + c / 2 + 3), '8', size=8.5, color=ACCENT if (i, j) in ok else INK, bold=(i, j) in ok)
    f.label((o + 3 * c, 9), 'первый бросок', size=7, color=INK, bold=False)
    f.raw(f'<text transform="translate(8 {o + 3 * c}) rotate(-90)" font-family="Times New Roman, Times, serif" '
          f'font-size="7" text-anchor="middle" fill="{INK}">второй бросок</text>')
    f.save('img/t5/sol/26.svg', width=250)


FIGS = [t5_26, t5_32, t5_44, t5_50, t5_51]
