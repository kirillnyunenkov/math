#!/usr/bin/env python3
"""Собирает og.html — страницу 1200x630 для скриншота.

Шрифты вшиваются base64: headless-браузер не ходит в сеть, а
подстановка системного шрифта ломает метрики макета.
"""
import base64, io, pathlib, sys
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1])

# Сабсеты и unicode-range — те же, что в index.html.
CYR = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"
LAT = ("U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
       "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")

def b64(p):
    return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

# Математические знаки ∫ π √ ни один сабсет сайта не покрывает.
# Берём их из Times New Roman Italic — тем же шрифтом сайт рисует .tex.
DECOR_CHARS = "x²∫π√"
def decor_woff2():
    src = "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf"
    f = TTFont(src)
    o = Options(); o.layout_features = ["*"]; o.desubroutinize = True
    s = Subsetter(options=o); s.populate(text=DECOR_CHARS); s.subset(f)
    buf = io.BytesIO(); f.flavor = "woff2"; f.save(buf)
    return base64.b64encode(buf.getvalue()).decode()

FONTS = f"""
@font-face{{font-family:'Golos Text';font-weight:400 700;font-style:normal;
  src:url(data:font/woff2;base64,{b64(ROOT/'fonts/golos-text-cyrillic.woff2')}) format('woff2');
  unicode-range:{CYR};}}
@font-face{{font-family:'Golos Text';font-weight:400 700;font-style:normal;
  src:url(data:font/woff2;base64,{b64(ROOT/'fonts/golos-text-latin.woff2')}) format('woff2');
  unicode-range:{LAT};}}
@font-face{{font-family:'Literata';font-weight:400 700;font-style:normal;
  src:url(data:font/woff2;base64,{b64(ROOT/'fonts/literata-cyrillic.woff2')}) format('woff2');
  unicode-range:{CYR};}}
@font-face{{font-family:'Literata';font-weight:400 700;font-style:normal;
  src:url(data:font/woff2;base64,{b64(ROOT/'fonts/literata-latin.woff2')}) format('woff2');
  unicode-range:{LAT};}}
@font-face{{font-family:'MathDecor';font-weight:400;font-style:normal;
  src:url(data:font/woff2;base64,{decor_woff2()}) format('woff2');}}
"""

HTML = """<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><style>
__FONTS__
/* Токены — тёмная тема index.html, html[data-theme="dark"] */
:root{
  --paper:#161713; --ink:#eae5da; --ink-2:#a8a498; --ink-3:#a09c8b;
  --accent:#7fb2ea; --accent-on:#0e1a28;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1200px;height:630px;background:var(--paper);color:var(--ink);
  font-family:'Golos Text',sans-serif;overflow:hidden;position:relative;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}

/* Акцентная полоса слева по всей высоте */
.bar{position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--accent);}

/* Очень слабое свечение справа: на тёмном фоне без него правая
   половина читается как пустая дыра, а не как поле с декором. */
.glow{position:absolute;right:-140px;top:-160px;width:760px;height:760px;
  border-radius:50%;background:radial-gradient(circle,rgba(127,178,234,.07) 0%,rgba(127,178,234,0) 68%);}

/* Математический декор — правая треть, вне текстовой колонки */
.decor{position:absolute;inset:0;font-family:'MathDecor',serif;
  color:var(--ink);line-height:1;user-select:none;}
.decor span{position:absolute;display:block;}
.d1{left:742px;top:62px;font-size:132px;opacity:.075;transform:rotate(-7deg);}
.d2{left:952px;top:110px;font-size:226px;opacity:.085;}
.d3{left:790px;top:330px;font-size:176px;opacity:.07;transform:rotate(5deg);}
.d4{left:1006px;top:424px;font-size:150px;opacity:.09;color:var(--accent);}

.stage{position:relative;height:100%;padding:74px 0 68px 84px;
  display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;}

/* Метка */
.eyebrow{display:flex;align-items:center;gap:13px;color:var(--accent);
  font-size:15px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;}
.eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none;}

h1{font-family:'Literata',Georgia,serif;font-weight:700;font-size:78px;
  line-height:1.13;letter-spacing:-.022em;margin:30px 0 26px;}
h1 span{color:var(--accent);}

p{font-size:23px;line-height:1.52;color:var(--ink-2);max-width:640px;}

/* Низ: плашка телеграма + адрес */
.foot{display:flex;align-items:center;gap:22px;}
.tg{display:flex;align-items:center;gap:11px;background:var(--accent);
  color:var(--accent-on);border-radius:999px;padding:14px 26px 14px 22px;
  font-size:21px;font-weight:600;letter-spacing:-.005em;}
.tg svg{width:22px;height:22px;flex:none;fill:currentColor;}
.url{font-size:18px;color:var(--ink-3);letter-spacing:.005em;}
</style></head><body>
<div class="bar"></div>
<div class="glow"></div>
<div class="decor">
  <span class="d1" data-m="d1">x²</span><span class="d2" data-m="d2">&#8747;</span>
  <span class="d3" data-m="d3">&#960;</span><span class="d4" data-m="d4">&#8730;</span>
</div>
<div class="stage">
  <div>
    <div class="eyebrow" data-m="eyebrow"><i></i>Подготовка к ЕГЭ по математике</div>
    <h1 data-m="h1">Тренажёр <span>ЕГЭ</span><br>по математике</h1>
    <p data-m="p">Задания с подробным разбором и проверкой ответов,
       пробные варианты и отслеживание прогресса.</p>
  </div>
  <div class="foot" data-m="foot">
    <div class="tg">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.04 15.47 8.7 20.2c.5 0 .72-.21.98-.47l2.34-2.24 4.86 3.56c.89.5 1.53.24 1.78-.82l3.21-15.05c.29-1.32-.48-1.84-1.35-1.52L1.68 9.85c-1.29.5-1.27 1.22-.22 1.54l4.96 1.55L18.1 5.5c.54-.36 1.04-.16.63.2z"/></svg>
      @kirill_math_tutor
    </div>
    <div class="url">kirillnyunenkov.github.io/math</div>
  </div>
</div>
</body></html>
"""

OUT.write_text(HTML.replace("__FONTS__", FONTS), encoding="utf-8")
print("написан", OUT, OUT.stat().st_size, "байт")
