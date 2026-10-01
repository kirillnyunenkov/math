# -*- coding: utf-8 -*-
"""Solution figures for task 10 (formula problems). Graphs are drawn from scratch from the
formula in the statement: they show which root of the quadratic answers the question.
Built by tools/annotate_figs.py."""
from annotate_figs import Fig, ACCENT, INK

W, H, L, R, T, B = 240, 150, 30, 14, 14, 24          # canvas and margins, pt


class _Plot:
    def __init__(self, t1, y0, y1, xlab, ylab):
        self.f = Fig.blank(W, H)
        self.t1, self.y0, self.y1 = t1, y0, y1
        f = self.f
        ax, ay = L, H - B
        f.segment((ax, ay), (W - 4, ay), color=INK, width=1.0)
        f.segment((ax, ay), (ax, 4), color=INK, width=1.0)
        f.raw(f'<path d="M {W - 9} {ay - 2.5} L {W - 4} {ay} L {W - 9} {ay + 2.5}" fill="none" stroke="{INK}" stroke-width="1"/>')
        f.raw(f'<path d="M {ax - 2.5} 9 L {ax} 4 L {ax + 2.5} 9" fill="none" stroke="{INK}" stroke-width="1"/>')
        f.label((W - 6, ay), xlab, dy=11, size=7.5, color=INK, bold=False, anchor='end')
        f.label((ax, 6), ylab, dx=5, dy=3, size=7.5, color=INK, bold=False, anchor='start')

    def X(self, t):
        return L + t / self.t1 * (W - L - R)

    def Y(self, y):
        return H - B - (y - self.y0) / (self.y1 - self.y0) * (H - B - T)

    def pts(self, fn, a, b, n=80):
        return [(self.X(a + (b - a) * i / n), self.Y(fn(a + (b - a) * i / n))) for i in range(n + 1)]

    def curve(self, fn, a, b, color=INK, width=1.4, dash=None):
        d = 'M ' + ' L '.join('%.2f %.2f' % p for p in self.pts(fn, a, b))
        dd = f' stroke-dasharray="{dash}"' if dash else ''
        self.f.raw(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round"{dd}/>')

    def level(self, y, text):
        self.f.segment((L, self.Y(y)), (W - R, self.Y(y)), color=INK, width=0.7, dash='3 2')
        self.f.label((L - 3, self.Y(y)), text, dy=2.5, size=7.5, color=INK, bold=False, anchor='end')

    def tick(self, t, text, y_from=None, accent=True):
        """Mark a moment on the time axis; a dashed drop line from the curve if y_from is given."""
        col = ACCENT if accent else INK
        if y_from is not None:
            self.f.segment((self.X(t), self.Y(y_from)), (self.X(t), H - B), color=col, width=0.8, dash='2 2')
        self.f.label((self.X(t), H - B), text, dy=11, size=8, color=col, bold=accent)


def t10_67():
    # Ball: h = 1.6 + 13t - 5t^2; at least 6 m between t = 0.4 and t = 2.2 -> 1.8 s.
    h = lambda t: 1.6 + 13 * t - 5 * t * t
    assert abs(h(0.4) - 6) < 1e-9 and abs(h(2.2) - 6) < 1e-9 and abs(2.2 - 0.4 - 1.8) < 1e-9
    p = _Plot(2.9, 0, 11, 't, с', 'h, м')
    f = p.f
    f.polygon(p.pts(h, 0.4, 2.2), opacity=0.28)                       # the part of the flight above 6 m
    p.curve(h, 0, 2.72)
    p.curve(h, 0.4, 2.2, color=ACCENT, width=2.2)
    p.level(6, '6')
    p.tick(0.4, '0,4', y_from=6)
    p.tick(2.2, '2,2', y_from=6)
    for t in (0.4, 2.2):
        f.point((p.X(t), p.Y(6)))
    ya = p.Y(6) + 9
    f.segment((p.X(0.4) + 2, ya), (p.X(2.2) - 2, ya), width=1.0)
    for x, s in ((p.X(0.4) + 2, 1), (p.X(2.2) - 2, -1)):
        f.raw(f'<path d="M {x + 4 * s:.2f} {ya - 2.5:.2f} L {x:.2f} {ya:.2f} L {x + 4 * s:.2f} {ya + 2.5:.2f}" fill="none" stroke="{ACCENT}" stroke-width="1"/>')
    f.label(((p.X(0.4) + p.X(2.2)) / 2, ya), '1,8 с', dy=9.5, size=8.5)
    f.label((p.X(1.3), p.Y(8.4)), 'выше 6 м', size=7.5)
    f.save('img/t10/sol/67.svg', width=320)


def t10_43():
    # Braking car: s = 15t - t^2 is valid until the stop at t = 7.5; s = 36 at t = 3 (and formally at t = 12).
    s = lambda t: 15 * t - t * t
    assert s(3) == 36 and s(12) == 36 and abs(15 / 2 - 7.5) < 1e-9 and s(7.5) == 56.25
    p = _Plot(13, 0, 62, 't, с', 's, м')
    f = p.f
    p.curve(s, 0, 7.5)
    p.curve(s, 7.5, 12.6, dash='2.5 2', width=0.9)
    p.level(36, '36')
    p.tick(3, '3', y_from=36)
    p.tick(12, '12', y_from=36, accent=False)
    p.tick(7.5, '7,5', y_from=56.25, accent=False)
    f.point((p.X(3), p.Y(36)))
    f.circle((p.X(12), p.Y(36)), 2.0, width=0.9, opacity=0)
    f.label((p.X(7.5), p.Y(56.25)), 'остановка', dy=-5, size=7.5, color=INK, bold=False)
    f.label((p.X(11.2), p.Y(52)), 'формула уже', size=6.5, color=INK, bold=False)
    f.label((p.X(11.2), p.Y(52)), 'не действует', dy=7.5, size=6.5, color=INK, bold=False)
    f.save('img/t10/sol/43.svg', width=320)


def t10_73():
    # Heater: T = 1600 + 105t - 5t^2 reaches the limit 1870 K at t = 3 (and falls back to it at t = 18).
    T_ = lambda t: 1600 + 105 * t - 5 * t * t
    assert T_(3) == 1870 and T_(18) == 1870 and T_(4) == 1940
    p = _Plot(21.5, 1500, 2200, 't, мин', 'T, К')
    f = p.f
    f.polygon(p.pts(T_, 3, 18), opacity=0.28)
    p.curve(T_, 0, 21)
    p.level(1870, '1870')
    f.label((L - 3, p.Y(1600)), '1600', dy=2.5, size=7.5, color=INK, bold=False, anchor='end')
    p.tick(3, '3', y_from=1870)
    p.tick(18, '18', y_from=1870, accent=False)
    f.point((p.X(3), p.Y(1870)))
    f.circle((p.X(18), p.Y(1870)), 2.0, width=0.9, opacity=0)
    f.label((p.X(10.5), p.Y(2010)), 'выше 1870 К —', size=7.5)
    f.label((p.X(10.5), p.Y(2010)), 'прибор портится', dy=8.5, size=7.5)
    f.save('img/t10/sol/73.svg', width=320)


def t10_49():
    # Tank: H = 8 - (2/3)t + t^2/72 touches zero once, at t = 24.
    H_ = lambda t: 8 - 2 * t / 3 + t * t / 72
    assert abs(H_(24)) < 1e-9 and abs(H_(0) - 8) < 1e-9
    p = _Plot(27, 0, 9, 't, мин', 'H, м')
    f = p.f
    p.curve(H_, 0, 24)
    f.label((L - 3, p.Y(8)), '8', dy=2.5, size=7.5, color=INK, bold=False, anchor='end')
    p.tick(24, '24')
    f.point((p.X(24), p.Y(0)))
    f.label((p.X(24), p.Y(0)), 'бак пуст', dy=-7, size=7.5)
    f.save('img/t10/sol/49.svg', width=320)


FIGS = [t10_43, t10_49, t10_67, t10_73]
