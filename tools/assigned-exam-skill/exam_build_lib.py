# -*- coding: utf-8 -*-
"""Helpers for ~/math-source/exams/<slug>/build_exam.py (the exam content itself never goes into the repo).

    import sys; sys.path.insert(0, '<repo>/tools/assigned-exam-skill')
    from exam_build_lib import Exam
    ex = Exam('/Users/kirill/math-source/exams/<slug>', 'Пробник №N', full=True)
    ex.short(1, cond_html, '0,3', ex.sol(idea, [step, ...], trap, fig=ex.img('sol1', 260, 'alt')))
    ex.long(14, 2, cond_html, answer_html)
    ex.write()

Run with /usr/bin/python3 (it has Pillow; the python3 on PATH may not). Figures are PNG files in <dir>/fig/<name>.png."""
import base64, io, json, os
from PIL import Image


class Exam:
    def __init__(self, folder, title, full=False):
        self.dir, self.title, self.full = folder, title, full
        self.tasks, self.key = [], {}

    def img(self, name, width, alt, max_px=900):
        """Embedded picture: shrunk to max_px, 48-colour PNG. width = the size shown on screen (css px)."""
        im = Image.open('%s/fig/%s.png' % (self.dir, name)).convert('RGB')
        if im.width > max_px:
            im = im.resize((max_px, round(im.height * max_px / im.width)), Image.LANCZOS)
        im = im.quantize(colors=48, method=Image.MEDIANCUT).convert('P')
        buf = io.BytesIO()
        im.save(buf, 'PNG', optimize=True)
        assert not set('"<>') & set(alt), 'alt must not contain " < >'
        return '<img src="data:image/png;base64,%s" width="%d" alt="%s">' % (base64.b64encode(buf.getvalue()).decode(), width, alt)

    @staticmethod
    def sol(idea, steps, trap=None, fig=None):
        """The approved format: Идея -> (figure) -> numbered one-action steps -> Где ошибаются (only if a real mistake exists).
        No class attributes (the validator refuses them): plain p / b / ol / li / table."""
        out = '<p><b>Идея.</b> %s</p>' % idea
        if fig:
            out += '<p>%s</p>' % fig
        out += '<ol>' + ''.join('<li>%s</li>' % x for x in steps) + '</ol>'
        if trap:
            out += '<p><b>Где ошибаются.</b> %s</p>' % trap
        return out

    def short(self, n, cond, answer, solution):
        self.tasks.append({'n': n, 'kind': 'short', 'max': 1, 'cond': cond})
        self.key[str(n)] = {'a': answer, 'sol': solution}

    def long(self, n, mx, cond, answer_html):
        self.tasks.append({'n': n, 'kind': 'long', 'max': mx, 'cond': cond})
        self.key[str(n)] = {'a': answer_html}

    def write(self):
        path = self.dir + '/exam.json'
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'title': self.title, 'full': self.full, 'tasks': self.tasks, 'key': self.key}, f, ensure_ascii=False)
        print('wrote', path, os.path.getsize(path), 'bytes')
