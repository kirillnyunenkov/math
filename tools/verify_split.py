#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка split_solutions.py: собрать data.js + sol.js обратно и сверить с оригиналом.

Сверяются все поля всех задач. Поле c сравнивается с вырезанными width/height —
их добавление единственное допустимое изменение.

Запуск:  python3 tools/verify_split.py <оригинальный_img> [--root .]
"""
import json, os, re, sys, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from split_solutions import load_task_data

WH_RE = re.compile(r'\s(?:width|height)="\d+"')


def strip_wh(s):
    return WH_RE.sub('', s or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('orig', help='каталог с оригинальными img/tN/data.js (до разделения)')
    ap.add_argument('--root', default='.')
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    orig = os.path.abspath(args.orig)

    problems = 0
    checked_items = checked_sols = 0

    for n in range(1, 20):
        op = os.path.join(orig, f'img/t{n}/data.js')
        np_ = os.path.join(root, f'img/t{n}/data.js')
        sp = os.path.join(root, f'img/t{n}/sol.js')
        if not os.path.exists(op):
            continue
        if not (os.path.exists(np_) and os.path.exists(sp)):
            print(f'!! t{n}: нет новых файлов'); problems += 1; continue

        old = load_task_data(op, n)
        new = load_task_data(np_, n)
        txt = open(sp, encoding='utf-8').read()
        m = re.search(r'window\.SOLDATA\[' + str(n) + r'\]\s*=\s*(\{.*\})\s*;\s*$', txt, re.S)
        sols = json.loads(m.group(1))

        if len(old) != len(new):
            print(f'!! t{n}: было {len(old)} задач, стало {len(new)}'); problems += 1; continue

        for i, (o, e) in enumerate(zip(old, new), start=1):
            checked_items += 1
            # решение
            want = (o.get('s') or '')
            got = sols.get(str(i), '')
            if want.strip():
                checked_sols += 1
                if want != got:
                    print(f'!! t{n} #{i}: решение не совпадает ({len(want)} -> {len(got)} симв.)')
                    problems += 1
            elif got:
                print(f'!! t{n} #{i}: решения не было, а в sol.js что-то есть'); problems += 1
            if 's' in e:
                print(f'!! t{n} #{i}: поле s осталось в data.js'); problems += 1
            # остальные поля
            for k in ('art', 'a', 'sub'):
                if (o.get(k) or '') != (e.get(k) or ''):
                    print(f'!! t{n} #{i}: поле {k}: {o.get(k)!r} -> {e.get(k)!r}'); problems += 1
            if strip_wh(o.get('c')) != strip_wh(e.get('c')):
                print(f'!! t{n} #{i}: условие изменилось не только размерами картинки'); problems += 1

    print(f'\nсверено задач: {checked_items}, решений: {checked_sols}')
    print('ВСЁ СОВПАДАЕТ' if problems == 0 else f'РАСХОЖДЕНИЙ: {problems}')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
