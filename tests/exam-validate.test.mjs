// tests/exam-validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const V = createRequire(import.meta.url)('../exam-validate.js');
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/exam-sample.json', import.meta.url), 'utf8'));
const errs = (x) => V.validateExam(x).errors;

test('the sample exam is valid and counted', () => {
  const r = V.validateExam(sample());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats, { short: 2, long: 1 });
});

test('structure errors are reported with the task number', () => {
  let x = sample(); x.title = '';
  assert.ok(errs(x).some((e) => /название/i.test(e)));
  x = sample(); x.tasks[1].n = 1;
  assert.ok(errs(x).some((e) => /повтор/i.test(e)));
  x = sample(); x.tasks[0].kind = 'medium';
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /kind/i.test(e)));
  x = sample(); x.tasks[0].max = 2;
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /1 балл/i.test(e)));
  x = sample(); x.tasks[2].max = 0;
  assert.ok(errs(x).some((e) => /задание 13/i.test(e) && /max/i.test(e)));
  x = sample(); x.tasks = [];
  assert.ok(errs(x).length > 0);
  assert.ok(errs(null).length > 0);
});

test('every task needs a key; short answers are plain text with a solution', () => {
  let x = sample(); delete x.key['2'];
  assert.ok(errs(x).some((e) => /задание 2/i.test(e) && /ключ|ответ/i.test(e)));
  x = sample(); x.key['1'].a = '<p>5</p>';
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /простым текстом/i.test(e)));
  x = sample(); x.key['1'].sol = '';
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /решени/i.test(e)));
  x = sample(); x.key['13'].a = '';
  assert.ok(errs(x).some((e) => /задание 13/i.test(e)));
  x = sample(); x.key['99'] = { a: '1' };
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /99/.test(w)));
});

test('unsafe HTML is refused', () => {
  const bad = ['<script>alert(1)</script>', '<p onclick="x()">a</p>', '<a href="javascript:alert(1)">a</a>',
    '<iframe src="x"></iframe>', '<img src="https://example.com/a.png">', '<style>p{display:none}</style>', '<img src=x onerror=alert(1)>'];
  for (const html of bad) { const x = sample(); x.tasks[0].cond = html; assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /html/i.test(e)), html); }
  const ok = sample(); ok.tasks[0].cond = '<p>a</p><img src="data:image/png;base64,iVBORw0KGgo=" width="10">';
  assert.deepEqual(errs(ok), []);
});

test('unsafe HTML: mixed case, data: URIs, svg/math, srcdoc and filter-evasion tricks are refused', () => {
  const bad = [
    '<SCRIPT>alert(1)</SCRIPT>', '<ScRiPt src=x></ScRiPt>', '<IFRAME SRC="x"></IFRAME>', '<STYLE>p{}</STYLE>',
    '<p ONCLICK="x()">a</p>', '<p OnMouseOver=x()>a</p>',
    '<a href="data:text/html,<b>x</b>">a</a>', '<a href="DATA:text/html;base64,PGI+">a</a>',
    '<img src="data:text/html;base64,PGI+">', '<img src="data:application/javascript;base64,AA==">',
    '<svg onload="alert(1)"></svg>', '<svg><circle r="1"/></svg>', '<SVG></SVG>', '<math><mi>x</mi></math>', '<MATH></MATH>',
    '<iframe srcdoc="<b>x</b>"></iframe>', '<p SRCDOC="x">a</p>',
    // evasion: no whitespace before the handler, ">" inside a quoted value, entities and tabs inside the scheme
    '<img/onerror=alert(1) src=x>', '<img src="data:image/png;base64,AA"onerror="x()">',
    '<img alt=">" onerror=alert(1) src="data:image/png;base64,AA">',
    '<a href="&#106;avascript:alert(1)">a</a>', '<a href="&#x6A;avascript:alert(1)">a</a>', '<a href="java\tscript:alert(1)">a</a>',
    '<a href=" JavaScript:alert(1)">a</a>',
    // loading things from outside the page
    '<img src="data:image/png;base64,AA" srcset="https://example.com/a.png 2x">', '<video src="data:image/png;base64,AA"></video>',
    '<img>', '<form action="https://example.com"><input></form>', '<base href="https://example.com/">',
  ];
  for (const html of bad) {
    const x = sample(); x.tasks[0].cond = html;
    assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /html/i.test(e)), 'cond: ' + html);
    const y = sample(); y.key['1'].sol = html;
    assert.ok(errs(y).some((e) => /задание 1/i.test(e) && /html/i.test(e)), 'sol: ' + html);
    const z = sample(); z.key['13'].a = html;
    assert.ok(errs(z).some((e) => /задание 13/i.test(e) && /html/i.test(e)), 'long a: ' + html);
  }
  const ok = [
    '<p>Если one = 1, то on = 1.</p>', '<p>$a<b$ и $x>1$</p>',
    '<img alt=">" src="data:image/png;base64,AA==">', '<IMG SRC="DATA:IMAGE/PNG;BASE64,AA==">',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" width="40" height="40">',
    '<p><a href="https://example.com/page">ссылка</a></p>', '<table><tr><td>1</td></tr></table>',
  ];
  for (const html of ok) { const x = sample(); x.tasks[0].cond = html; assert.deepEqual(errs(x), [], html); }
});

test('the size caps match the server fields', () => {
  const x = sample(); x.tasks[0].cond = '<p>' + 'a'.repeat(4_900_000) + '</p>';
  assert.ok(errs(x).some((e) => /размер/i.test(e) && /задан/i.test(e)));
  const y = sample(); y.key['1'].sol = '<p>' + 'a'.repeat(1_950_000) + '</p>';
  assert.ok(errs(y).some((e) => /размер/i.test(e) && /ключ/i.test(e)));
});

test('a part 2 solution is a warning, an odd short answer is a warning', () => {
  const x = sample(); x.key['13'].sol = '<p>x</p>'; x.key['1'].a = 'очень длинный текст ответа';
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
});

test('extractFormulas finds inline and display formulas', () => {
  assert.deepEqual(V.extractFormulas('<p>Найдите $2+3$ и $$x^2$$ и $\\dfrac{1}{2}$.</p>'),
    [{ tex: 'x^2', display: true }, { tex: '2+3', display: false }, { tex: '\\dfrac{1}{2}', display: false }]);
  assert.deepEqual(V.extractFormulas('<p>без формул, цена 5 рублей</p>'), []);
});

test('validateExam never throws on garbage and reports errors', () => {
  const task = { n: 1, kind: 'short', max: 1, cond: 'c' };
  const garbage = [
    undefined, null, 0, 5, true, 'text', [], [[]], [null], {}, { title: 'x' }, { title: 5, tasks: 5, key: 5 },
    { title: 'x', tasks: null, key: {} }, { title: 'x', tasks: {}, key: {} }, { title: 'x', tasks: 'abc', key: {} },
    { title: 'x', tasks: [null, 5, 'a', [], {}, [[]]], key: {} },
    { title: 'x', tasks: [task], key: null }, { title: 'x', tasks: [task], key: [] }, { title: 'x', tasks: [task], key: 'k' },
    { title: 'x', tasks: [task], key: { 1: 'a string entry' } }, { title: 'x', tasks: [task], key: { 1: null } },
    { title: 'x', tasks: [task], key: { 1: [] } }, { title: 'x', tasks: [task], key: { 1: 7 } },
    { title: 'x', tasks: [task], key: { 1: { a: 5, sol: 6 } } }, { title: 'x', tasks: [task], key: { 1: { a: { x: 1 }, sol: [] } } },
    { title: 'x', tasks: [{ n: '1', kind: 'short', max: 1, cond: 'c' }], key: {} },
    { title: 'x', tasks: [{ n: 1, kind: 'long', max: 2, cond: { html: 1 } }], key: { 1: { a: ['x'] } } },
    { title: 'x', tasks: [{ n: 1.5, kind: [], max: '1', cond: 7 }], key: { constructor: 1 } },
    { title: ['x'], full: 'yes', tasks: [task], key: { 1: { a: '1', sol: 's' } } },
    JSON.parse('{"title":"x","tasks":[{"n":1,"kind":"long","max":1,"cond":"c"}],"key":{"__proto__":{"a":"1"},"1":"s"}}'),
    JSON.parse('{"title":"x","tasks":[{"n":1,"kind":"short","max":1,"cond":"","__proto__":null}],"key":{"1":{"a":"1","sol":"s","__proto__":5}},"__proto__":[]}'),
  ];
  for (const g of garbage) {
    let r;
    assert.doesNotThrow(() => { r = V.validateExam(g); }, JSON.stringify(g));
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0, 'errors expected for ' + JSON.stringify(g));
    assert.ok(Array.isArray(r.warnings) && r.stats && typeof r.stats.short === 'number');
  }
  assert.doesNotThrow(() => V.extractFormulas(null));
  assert.doesNotThrow(() => V.extractFormulas({ not: 'a string' }));
});
