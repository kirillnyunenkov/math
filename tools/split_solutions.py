#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Разделение данных тренажёра: условия и решения — в разные файлы.

Зачем: решения занимают ~99% веса data.js, но грузятся до первой карточки,
хотя ученик может их не открыть ни разу. После разделения экран задания
стартует с 1-6 КБ вместо 130-790 КБ (gzip).

Заодно впекает width/height в теги рисунков условий: без них ленивая
картинка приезжает в неразмеченный бокс и двигает вёрстку.

Вход:   img/tN/data.js   window.TASKDATA[N]=[{art,c,s,a,sub}]
Выход:  img/tN/data.js   window.TASKDATA[N]=[{art,c,a,sub}]      (без s)
        img/tN/sol.js    window.SOLDATA[N]={"<id>":"<html>"}     (только непустые)

id в sol.js — те же 1-based позиции, что в TASKDATA и PROTOTYPES.

Запуск:  python3 tools/split_solutions.py            # проверка, ничего не пишет
         python3 tools/split_solutions.py --write    # записать
"""
import json, os, re, struct, sys, gzip, argparse

FIG_RE = re.compile(r'<img\b([^>]*?)\ssrc="(img/t\d+/gfx/[^"]+)"([^>]*?)>')
WH_ATTR_RE = re.compile(r'\s(?:width|height)="\d+"')


def png_size(path):
    """Ширина и высота PNG из заголовка IHDR — без распаковки пикселей."""
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


# Каким размером рисунок реально показывается: те же ограничения, что в CSS
# (.cond .figwrap img.fig — max-width 280, max-height 300). Пишем в атрибуты
# именно ЭТОТ размер, а не натуральный.
# Почему не натуральный: браузер берёт width из атрибута только как
# presentational hint, и любое авторское width:auto его перебивает. Тогда у
# незагруженной картинки нет ни одного определённого измерения, aspect-ratio
# посчитать не от чего, и коробка выходит 0x0 — место не резервируется вовсе.
# С отображаемым размером в атрибуте и height:auto в CSS коробка известна
# до загрузки, а max-width:100% ужимает её на узких экранах.
CAP_W, CAP_H = 280, 300


def display_size(w, h):
    scale = min(CAP_W / w, CAP_H / h, 1.0)
    return max(1, round(w * scale)), max(1, round(h * scale))


def add_dimensions(cond_html, root, stats):
    """Проставить в теги рисунков отображаемый размер (пересчитывается всегда)."""
    def sub(m):
        before, src, after = m.group(1), m.group(2), m.group(3)
        # старые width/height (натуральные) убираем — считаем заново от PNG
        before = WH_ATTR_RE.sub('', before)
        after = WH_ATTR_RE.sub('', after)
        path = os.path.join(root, src)
        if not os.path.exists(path):
            stats['missing'] += 1
            return f'<img{before} src="{src}"{after}>'
        size = png_size(path)
        if not size:
            stats['missing'] += 1
            return f'<img{before} src="{src}"{after}>'
        dw, dh = display_size(*size)
        stats['added'] += 1
        return f'<img{before} src="{src}" width="{dw}" height="{dh}"{after}>'
    return FIG_RE.sub(sub, cond_html)


def load_task_data(path, n):
    """Прочитать img/tN/data.js. Терпит и старый формат (с s), и уже разделённый."""
    txt = open(path, encoding='utf-8').read()
    m = re.search(r'window\.TASKDATA\[' + str(n) + r'\]\s*=\s*(\[.*\])\s*;\s*$', txt, re.S)
    if not m:
        raise ValueError(f'{path}: не нашёл window.TASKDATA[{n}]=[...]')
    return json.loads(m.group(1))


def dump_js(lines):
    return ''.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.', help='корень репозитория (где лежит img/)')
    ap.add_argument('--write', action='store_true', help='записать файлы (иначе — сухой прогон)')
    args = ap.parse_args()
    root = os.path.abspath(args.root)

    total_before = total_data = total_sol = 0
    figs = {'added': 0, 'already': 0, 'missing': 0}
    report = []

    for n in range(1, 20):
        data_path = os.path.join(root, f'img/t{n}/data.js')
        if not os.path.exists(data_path):
            continue
        arr = load_task_data(data_path, n)

        conds, sols = [], {}
        for idx, item in enumerate(arr, start=1):
            sol = (item.get('s') or '').strip()
            if sol:
                sols[str(idx)] = item['s']
            cond = dict(item)
            cond.pop('s', None)
            cond['c'] = add_dimensions(cond.get('c') or '', root, figs)
            conds.append(cond)

        data_js = ('window.TASKDATA=window.TASKDATA||{};\n'
                   f'window.TASKDATA[{n}]=' + json.dumps(conds, ensure_ascii=False) + ';\n')
        sol_js = ('window.SOLDATA=window.SOLDATA||{};\n'
                  f'window.SOLDATA[{n}]=' + json.dumps(sols, ensure_ascii=False) + ';\n')

        # ЗАЩИТА ОТ ПОВТОРНОГО ПРОГОНА.
        # Второй запуск читает уже разделённый data.js, где поля s нет, —
        # и молча перезаписывает sol.js пустым, стирая все разборы.
        # Если решений не нашлось, а рядом лежит непустой sol.js — это оно.
        sol_path = os.path.join(root, f'img/t{n}/sol.js')
        if not sols and os.path.exists(sol_path) and os.path.getsize(sol_path) > 200:
            print(f'!! t{n}: в data.js решений нет, а img/t{n}/sol.js непустой.')
            print('   Похоже на повторный прогон по уже разделённым данным.')
            print('   Такой запуск стёр бы разборы — прерываюсь, ничего не записано.')
            sys.exit(2)

        before = os.path.getsize(data_path)
        gz = lambda s: len(gzip.compress(s.encode('utf-8'), 9))
        total_before += gz(open(data_path, encoding='utf-8').read())
        total_data += gz(data_js)
        total_sol += gz(sol_js)

        report.append((n, len(arr), len(sols), gz(open(data_path, encoding='utf-8').read()),
                       gz(data_js), gz(sol_js)))

        if args.write:
            with open(data_path, 'w', encoding='utf-8') as f:
                f.write(data_js)
            with open(os.path.join(root, f'img/t{n}/sol.js'), 'w', encoding='utf-8') as f:
                f.write(sol_js)

    print(f"{'зад':>4} {'задач':>6} {'решений':>8} {'было gz':>9} {'data.js':>9} {'sol.js':>9}")
    for n, items, nsol, b, d, s in report:
        print(f'{n:>4} {items:>6} {nsol:>8} {b/1024:>8.1f}K {d/1024:>8.1f}K {s/1024:>8.1f}K')
    print(f"{'ИТОГО':>4} {'':>6} {'':>8} {total_before/1024:>8.1f}K "
          f'{total_data/1024:>8.1f}K {total_sol/1024:>8.1f}K')
    print(f"\nрисунки: проставлено width/height {figs['added']}, "
          f"уже было {figs['already']}, не найдено {figs['missing']}")
    print('\nЗАПИСАНО' if args.write else '\nсухой прогон — файлы не тронуты (--write чтобы записать)')


if __name__ == '__main__':
    main()
