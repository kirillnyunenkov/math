#!/usr/bin/env python3
"""Генерирует логотип тренажёра и все растровые иконки.

Знак — радикал √: одновременно математический символ и галочка «верно».
Штрих такой же, как у иконок интерфейса (круглые концы и стыки), цвета —
из дизайн-системы: чернильно-синий бренд + бумажный тёплый белый.

    python3 tools/icons/make_icons.py

Пишет в корень репозитория: logo.svg, icon-192.png, icon-512.png,
icon-maskable-512.png, apple-touch-icon.png, favicon-32.png, favicon.ico.
Растеризация — headless Chrome (другого растеризатора на машине нет),
поэтому Chrome должен быть установлен.
"""
import pathlib, struct, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

BG_FROM, BG_TO = "#2a67a4", "#143a63"   # градиент акцента --accent #1d4e89
FG = "#f4f1ea"                          # тёплая бумага
STROKE = 44
# Опорные точки радикала: вход, начало «галки», низ, верх, черта вправо.
PTS = [(108, 258), (166, 258), (236, 404), (334, 110), (430, 110)]


def mark(scale, stroke=STROKE):
    """Знак, отцентрованный по холсту 512 с учётом круглых концов."""
    xs = [p[0] for p in PTS]; ys = [p[1] for p in PTS]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    d = "M " + " L ".join(f"{x} {y}" for x, y in PTS)
    return (f'<g transform="translate(256 256) scale({scale}) translate({-cx} {-cy})" '
            f'fill="none" stroke="{FG}" stroke-width="{stroke}" '
            f'stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></g>')


def icon_svg(scale=0.90, radius=0, stroke=STROKE):
    rx = f' rx="{radius}"' if radius else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{BG_FROM}"/><stop offset="1" stop-color="{BG_TO}"/>'
            f'</linearGradient></defs>'
            f'<rect width="512" height="512"{rx} fill="url(#g)"/>{mark(scale, stroke)}</svg>')


# Во вкладке иконка живёт в 16-32 px: знак крупнее и жирнее, иначе радикал
# на таком кегле расплывается в синее пятно.
FAVICON = dict(scale=0.94, stroke=52)


def ico(pngs, out):
    """Многоразмерный .ico из готовых PNG (Vista+ разрешает PNG внутри ICO).

    Отдельный файл нужен, потому что за /favicon.ico браузеры и агрегаторы
    ходят напрямую, не читая <link> в разметке.
    """
    data = [p.read_bytes() for p in pngs]
    sizes = [16, 32, 48][:len(data)]
    offset = 6 + 16 * len(data)
    head = struct.pack("<HHH", 0, 1, len(data))
    dirs, body = b"", b""
    for size, blob in zip(sizes, data):
        dirs += struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(blob), offset)
        body += blob
        offset += len(blob)
    out.write_bytes(head + dirs + body)
    print(f"{out.name}: {out.stat().st_size} байт ({', '.join(map(str, sizes))})")


def render(svg_text, size, out):
    """SVG → PNG нужного размера через headless Chrome."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / "i.svg").write_text(svg_text, encoding="utf-8")
        (tmp / "p.html").write_text(
            f'<!doctype html><meta charset=utf-8><style>html,body{{margin:0;padding:0}}'
            f'img{{display:block;width:{size}px;height:{size}px}}</style>'
            f'<img src="i.svg">', encoding="utf-8")
        subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                        f"--screenshot={out}", f"--window-size={size},{size}",
                        "--force-device-scale-factor=1", str(tmp / "p.html")],
                       check=True, capture_output=True)
    print(f"{out.name}: {out.stat().st_size} байт")


def main():
    if not pathlib.Path(CHROME).exists():
        sys.exit(f"нет Chrome: {CHROME}")
    (ROOT / "logo.svg").write_text(icon_svg(radius=96), encoding="utf-8")
    print("logo.svg — исходник знака (он же favicon)")
    full = icon_svg()                 # под завязку: системы сами скругляют углы
    render(full, 512, ROOT / "icon-512.png")
    render(full, 192, ROOT / "icon-192.png")
    render(full, 180, ROOT / "apple-touch-icon.png")
    # maskable: знак должен уместиться в круг безопасной зоны (80% холста)
    render(icon_svg(scale=0.68), 512, ROOT / "icon-maskable-512.png")
    # вкладка браузера
    tab = icon_svg(**FAVICON)
    render(tab, 32, ROOT / "favicon-32.png")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        parts = []
        for size in (16, 32, 48):
            f = tmp / f"f{size}.png"
            render(tab, size, f)
            parts.append(f)
        ico(parts, ROOT / "favicon.ico")


if __name__ == "__main__":
    main()
