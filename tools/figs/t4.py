# -*- coding: utf-8 -*-
"""Solution figures for task 4 (simple probability). Drawn from scratch.
Trees go top-down (the owner's convention). Built by tools/annotate_figs.py."""
from itertools import product
from annotate_figs import Fig, ACCENT, INK


def coin_tree(dst, depth, letters, hot, rows, width):
    """Full binary tree of `depth` fair choices; leaves listed in `hot` are highlighted."""
    leaves = [''.join(p) for p in product(letters, repeat=depth)]
    assert all(h in leaves for h in hot)
    left, step, dy = 38, (30 if depth == 3 else 52), 34
    w = left + step * len(leaves)
    f = Fig.blank(w, 20 + dy * depth + 18)
    x = lambda level, i: left + step * len(leaves) * (i + 0.5) / 2 ** level
    y = lambda level: 12 + dy * level
    on_path = lambda prefix: any(h.startswith(prefix) for h in hot)
    for level in range(depth):
        for i, prefix in enumerate(''.join(p) for p in product(letters, repeat=level)):
            for k, ch in enumerate(letters):
                a, b = (x(level, i), y(level)), (x(level + 1, 2 * i + k), y(level + 1))
                hotedge = on_path(prefix + ch)
                f.segment(a, b, color=ACCENT if hotedge else INK, width=1.6 if hotedge else 0.8)
    for level in range(depth + 1):
        for i, prefix in enumerate(''.join(p) for p in product(letters, repeat=level)):
            f.point((x(level, i), y(level)), r=1.6 if on_path(prefix) else 1.1)
            if 0 < level < depth:
                side = -1 if prefix[-1] == letters[0] else 1
                f.label((x(level, i), y(level)), prefix[-1], dx=5 * side, dy=-2, size=7.5,
                        anchor='end' if side < 0 else 'start',
                        color=ACCENT if on_path(prefix) else INK, bold=on_path(prefix))
    for i, leaf in enumerate(leaves):
        f.label((x(depth, i), y(depth)), leaf, dy=11, size=7.5 if depth == 3 else 8.5,
                color=ACCENT if leaf in hot else INK, bold=leaf in hot)
    for level, text in enumerate(rows, start=1):
        f.label((2, y(level)), text, dy=-dy / 2 + 2.5, size=6.5, color=INK, bold=False, anchor='start')
    f.save(dst, width=width)


def t4_59():
    coin_tree('img/t4/sol/59.svg', 3, ('Д', 'Н'), ['ДДД'], ['1-й матч', '2-й матч', '3-й матч'], 320)


def t4_65():
    coin_tree('img/t4/sol/65.svg', 3, ('Д', 'Н'), ['НДН'], ['1-я игра', '2-я игра', '3-я игра'], 320)


def t4_71():
    coin_tree('img/t4/sol/71.svg', 2, ('О', 'Р'), ['ОР', 'РО'], ['1-й бросок', '2-й бросок'], 280)


def zones(dst, marks, labels, hot, bracket=None):
    """An axis cut into zones by `marks`; zone `hot` is highlighted; `bracket` = (from, to, text) spans zones on top."""
    f = Fig.blank(250, 84)
    y, x0, x1 = 50, 8, 242
    xs = [x0] + [x0 + (x1 - x0) * (i + 1) / (len(marks) + 1) for i in range(len(marks))] + [x1]
    f.polygon([(xs[hot], y - 8), (xs[hot + 1], y - 8), (xs[hot + 1], y + 8), (xs[hot], y + 8)], opacity=0.28)
    f.segment((x0, y), (x1, y), color=INK, width=1.1)
    f.raw(f'<path d="M {x1 - 6} {y - 3} L {x1} {y} L {x1 - 6} {y + 3}" fill="none" stroke="{INK}" stroke-width="1.1"/>')
    for x, t in zip(xs[1:-1], marks):
        f.segment((x, y - 10), (x, y + 10), color=INK, width=1.1)
    for i, (name, prob) in enumerate(labels):
        cx = (xs[i] + xs[i + 1]) / 2
        f.label((cx, y + 20), name, size=7, color=ACCENT if i == hot else INK, bold=i == hot)
        f.label((cx, y - 12), prob, size=9 if i == hot else 8, color=ACCENT if i == hot else INK, bold=i == hot)
    if bracket:
        a, b, text = bracket
        yb = y - 26
        f.raw(f'<path d="M {xs[a] + 2:.1f} {yb + 5} L {xs[a] + 2:.1f} {yb} L {xs[b] - 2:.1f} {yb} L {xs[b] - 2:.1f} {yb + 5}" '
              f'fill="none" stroke="{INK}" stroke-width="0.8"/>')
        f.label(((xs[a] + xs[b]) / 2, yb - 4), text, size=7.5, color=INK, bold=False)
    f.save(dst, width=320)


def t4_105():
    assert abs(0.86 - 0.73 - 0.13) < 1e-12 and abs(1 - 0.86 - 0.14) < 1e-12
    zones('img/t4/sol/105.svg', ['', ''], [('3 и меньше', '0,14'), ('ровно 4', '0,13'), ('5 и больше', '0,73')], 1,
          bracket=(1, 3, 'больше трёх: 0,86'))


def t4_111():
    assert abs(0.94 - 0.56 - 0.38) < 1e-12 and abs(1 - 0.94 - 0.06) < 1e-12
    zones('img/t4/sol/111.svg', ['', ''], [('меньше 15', '0,56'), ('от 15 до 19', '0,38'), ('20 и больше', '0,06')], 1,
          bracket=(0, 2, 'меньше 20: 0,94'))


FIGS = [t4_59, t4_65, t4_71, t4_105, t4_111]
