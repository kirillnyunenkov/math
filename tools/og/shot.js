// Скриншот og.html в 2x — даунсемпл до 1200x630 даёт мягкое сглаживание.
// Заодно печатает габариты декора и текста: декор не должен вылезать
// за холст и наезжать на текстовую колонку.
const puppeteer = require('puppeteer');
const path = process.argv[2], out = process.argv[3];
(async () => {
  const browser = await puppeteer.launch({args: ['--font-render-hinting=none']});
  const page = await browser.newPage();
  await page.setViewport({width: 1200, height: 630, deviceScaleFactor: 2});
  await page.goto('file://' + path, {waitUntil: 'networkidle0'});
  await page.evaluate(() => document.fonts.ready);

  const boxes = await page.evaluate(() => {
    const r = {};
    for (const el of document.querySelectorAll('[data-m]')) {
      const b = el.getBoundingClientRect();
      r[el.dataset.m] = [b.left, b.top, b.right, b.bottom].map(v => Math.round(v));
    }
    return r;
  });
  const decor = Object.entries(boxes).filter(([k]) => k.startsWith('d'));
  const text  = Object.entries(boxes).filter(([k]) => !k.startsWith('d'));
  const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  for (const [k, v] of Object.entries(boxes)) {
    const off = v[0] < 0 || v[1] < 0 || v[2] > 1200 || v[3] > 630;
    console.log(k.padEnd(8), JSON.stringify(v), off ? '  <-- ВЫЛЕЗАЕТ' : '');
  }
  for (const [dk, dv] of decor)
    for (const [tk, tv] of text)
      if (hit(dv, tv)) console.log(`ПЕРЕСЕЧЕНИЕ: ${dk} x ${tk}`);

  await page.screenshot({path: out});
  await browser.close();
})();
