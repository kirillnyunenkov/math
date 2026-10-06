#!/usr/bin/env python3
"""Reads a saved Shkolkovo variant page ("Поставьте баллы своим ответам.html" + its _files folder)
and writes a readable dump for typesetting a mock exam. Nothing here goes into the repository:
point OUT at ~/math-source/exams/<slug>/.

    python3 tools/assigned-exam-skill/shkolkovo_extract.py "<page>.html" ~/math-source/exams/<slug>/

Writes OUT/tasks.txt (per task: number, bank id, points, statement, the site's answer and solution,
criteria; formulas appear as [ascii-art alt|file]) and copies every picture that is not a formula
(statement drawings, solution drawings) into OUT/src/. The alt text of a formula is ASCII art and
can be wrong (fractions, roots, systems): read the formula as an image (render_svg.py) before typesetting
anything that looks odd. Treat the site's answers as claims to be recomputed, not as truth."""
import html, os, re, shutil, sys

page, out = sys.argv[1], os.path.expanduser(sys.argv[2])
files = os.path.splitext(page)[0] + '_files'
s = open(page, encoding='utf-8').read()
os.makedirs(out + '/src', exist_ok=True)
s = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
i = s.find('Первая часть')
j = s.find('Перейти к результатам', i)
s = s[i:j] if i >= 0 and j > i else s
copied = []


def is_drawing(path):
    if not path.endswith('.svg'):
        return True
    head = open(path, encoding='utf-8', errors='ignore').read(1500)
    w, h = re.search(r"width='([\d.]+)pt'", head), re.search(r"height='([\d.]+)pt'", head)
    return bool(w and h and (float(h.group(1)) > 45 or float(w.group(1)) > 330))


def pic(m):
    tag = m.group(0)
    alt = html.unescape((re.search(r'alt="([^"]*)"', tag) or [0, ''])[1])
    src = re.search(r'src="([^"]*)"', tag).group(1)
    name = os.path.basename(src)
    fp = os.path.join(files, name)
    if os.path.exists(fp) and is_drawing(fp):         # drawings and graphs (they carry junk alt text); one-line formulas are skipped
        shutil.copy(fp, out + '/src/' + name)
        copied.append(name)
    short = name[6:14] if name.startswith('index-') else name
    return '[%s|%s]' % (re.sub(r'\s+', ' ', alt).strip() or 'PIC', short)


s = re.sub(r'<img[^>]*>', pic, s)
s = re.sub(r'<[^>]+>', ' ', s)
body = html.unescape(re.sub(r'\s+', ' ', s))
parts = re.split(r'(?=Задание \d+ #\d+)', body)
with open(out + '/tasks.txt', 'w', encoding='utf-8') as f:
    for p in parts:
        p = p.strip()
        if p:
            f.write(p + '\n\n' + '=' * 80 + '\n\n')
print('tasks:', len([p for p in parts if re.match(r'Задание \d+ #', p.strip())]), '| pictures copied:', len(copied), '->', out + '/src')
print('A picture is shown as [alt|hash]; drawings/graphs (and big displayed formulas) are in src/index-<hash>*.svg with junk alt text: render them')
print('to see them:  /usr/bin/python3 tools/assigned-exam-skill/render_svg.py src/<file>.svg out.png   (headless Chrome, 2x)')
