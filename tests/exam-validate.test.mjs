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

// Every raw-text / special element whose parsing differs from the plain tokeniser: a payload hides
// a tag inside a quoted attribute value that the browser never sees as an attribute.
const RAW_TAGS = ['noscript', 'textarea', 'xmp', 'title', 'noembed', 'noframes', 'style', 'script', 'iframe', 'plaintext'];
const BYPASS = [
  '<!-- <a title="--><img src=x onerror=alert(1)> "> -->',
  '<![CDATA[ <a title="]]><img src=x onerror=alert(1)>">',
  '</ <a title="><img src=x onerror=alert(1)>">',
  '<? <a title="?><img src=x onerror=alert(1)>">',
];
for (const t of RAW_TAGS) {
  BYPASS.push('<' + t + '><p title="</' + t + '><img src=x onerror=alert(1)>">');
  BYPASS.push('<' + t + '><a title="</' + t + '><img src=x onerror=alert(1)>">');
}

// Checks one HTML snippet in every field that is gated: cond, short sol, long a, long sol.
// Which task a field belongs to (cond and short sol: task 1; long a and long sol: task 13).
const FIELD_TASK = { cond: /задание 1\b/i, 'short sol': /задание 1\b/i, 'long a': /задание 13\b/i, 'long sol': /задание 13\b/i };
const everyField = (html) => {
  const out = {};
  let x = sample(); x.tasks[0].cond = html; out.cond = x;
  x = sample(); x.key['1'].sol = html; out['short sol'] = x;
  x = sample(); x.key['13'].a = html; out['long a'] = x;
  x = sample(); x.key['13'].sol = html; out['long sol'] = x;
  return out;
};

test('parser-differential bypass payloads are refused in every HTML field', () => {
  for (const html of BYPASS) {
    for (const [field, x] of Object.entries(everyField(html))) {
      assert.ok(errs(x).some((e) => FIELD_TASK[field].test(e) && /html/i.test(e)), field + ': ' + html);
    }
  }
});

test('unsafe HTML: case, data: URIs, svg/math, srcdoc, links, evasion tricks and odd grammar are refused', () => {
  const bad = [
    '<SCRIPT>alert(1)</SCRIPT>', '<ScRiPt src=x></ScRiPt>', '<IFRAME SRC="x"></IFRAME>', '<STYLE>p{}</STYLE>',
    '<p ONCLICK="x()">a</p>', '<p OnMouseOver=x()>a</p>', '<P>x</P>', '<p>x</P>', '<Br>', '<IMG SRC="DATA:IMAGE/PNG;BASE64,AA==">',
    '<a href="data:text/html,<b>x</b>">a</a>', '<a href="DATA:text/html;base64,PGI+">a</a>',
    '<img src="data:text/html;base64,PGI+">', '<img src="data:application/javascript;base64,AA==">',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">', '<img src="data:image/png;charset=x;base64,AA==">',
    '<svg onload="alert(1)"></svg>', '<svg><circle r="1"/></svg>', '<SVG></SVG>', '<math><mi>x</mi></math>', '<MATH></MATH>',
    '<iframe srcdoc="<b>x</b>"></iframe>', '<p SRCDOC="x">a</p>',
    // evasion: no whitespace before the handler, ">" inside a quoted value, entities, tabs and form feeds
    '<img/onerror=alert(1) src=x>', '<img src="data:image/png;base64,AA=="onerror="x()">',
    '<img alt=">" onerror=alert(1) src="data:image/png;base64,AA==">', '<img alt=">" src="data:image/png;base64,AA==">',
    '<a href="&#x6A;avascript:alert(1)">a</a>', '<a href="&#106;avascript:alert(1)">a</a>',
    // duplicate attributes are each checked; unusual whitespace between attributes is outside the grammar
    '<img src="data:image/png;base64,AA==" src="https://example.com/a.png">', '<img src="https://example.com/a.png" src="data:image/png;base64,AA==">',
    '<img src="data:image/png;base64,AA==" width="1" width="x">', '<img\u00a0src="data:image/png;base64,AA==">',
    '<img\vsrc="data:image/png;base64,AA==">', '<img\u2028src="data:image/png;base64,AA==">', '<img src="data:image/png;base64,AA=="\u00a0width="1">',
    '<p\u00a0onclick="x()">a</p>', '<p\u2028onclick="x()">a</p>', '<p\vonclick="x()">a</p>', '<a href="java\tscript:alert(1)">a</a>', '<a href=" JavaScript:alert(1)">a</a>',
    '<p\fonclick=alert(1)>a</p>', '<p/onclick=alert(1)>a</p>', '<p\nonclick=alert(1)>a</p>',
    // quoting and syntax outside the strict grammar
    "<img src='data:image/png;base64,AA=='>", '<img src=data:image/png;base64,AA==>', '<br x>', '<p class>', '</p >', '</p x="1">', '<p',
    // NUL bytes, comments, doctype, processing instructions
    '<p>a\u0000b</p>', '<!-- x -->', '<!DOCTYPE html>', '<?xml version="1.0"?>', '</ p>', '</3>', '</>',
    // links, forms, inputs, buttons and every other tag off the allowlist
    '<a href="https://example.com/page">a</a>', '<a>a</a>', '<form action="https://example.com"><input></form>', '<base href="https://example.com/">',
    '<input>', '<button>b</button>', '<textarea>t</textarea>', '<template><p>x</p></template>', '<video src="x"></video>', '<font>x</font>',
    '<center>x</center>', '<img>', '<img alt="x">', '<link rel="stylesheet" href="x">', '<meta http-equiv="refresh" content="0">',
    // attributes off the allowlist, on every tag
    '<p style="color:red">a</p>', '<p id="a">a</p>', '<p class="a">a</p>', '<p title="a">a</p>', '<p name="a">a</p>', '<p href="x">a</p>',
    '<span style="x">a</span>', '<td style="x">a</td>', '<td colspan="2" id="c">a</td>', '<p data-x="1">a</p>', '<p lang="ru">a</p>',
    '<img src="data:image/png;base64,AA==" style="width:1px">', '<img src="data:image/png;base64,AA==" class="a">',
    '<img src="data:image/png;base64,AA==" srcset="https://example.com/a.png 2x">', '<img src="data:image/png;base64,AA==" onerror="x()">',
    '<img src="data:image/png;base64,AA==" title="t">', '<p width="1">a</p>', '<th src="x">a</th>', '<p onclick="x">a</p>',
    // attribute values off the allowlist
    '<img src="data:image/png;base64,AA==" width="10;x">', '<img src="data:image/png;base64,AA==" height="x">',
    '<img src="data:image/png;base64,AA==" width="-1">', '<td colspan="x">a</td>', '<td rowspan="1px">a</td>', '<td align="justify">a</td>',
    '<img src="data:image/png;base64,AA== ">', '<img src="https://example.com/a.png">', '<img src="//example.com/a.png">',
    // a "less than" sign glued to a letter is destroyed by the browser (and would hide formulas)
    '<p>$a<b$</p>', '<p>$x<y$</p>', '<p>x<y</p>',
  ];
  for (const html of bad) {
    for (const [field, x] of Object.entries(everyField(html))) {
      assert.ok(errs(x).some((e) => FIELD_TASK[field].test(e) && /html/i.test(e)), field + ': ' + JSON.stringify(html));
    }
  }
});

test('allowed HTML passes in every HTML field', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const ok = [
    '<p>Если one = 1, то on = 1.</p>', '<p>Привет, мир: &lt; &gt; &amp; &quot; &nbsp; &#8722; &#x2212;.</p>',
    '<p>a < b, a <= b, 5 <6, x<3, x <3, 1<2, a<$b$, a<</p>', '<p>$a< b$ и $a \\lt b$ и $a&lt;b$</p>',
    '<p><b>b</b> <i>i</i> <em>e</em> <strong>s</strong> <u>u</u> x<sup>2</sup> x<sub>1</sub> <span>s</span></p>',
    '<ul><li>1</li><li>2</li></ul><ol><li>1</li></ol>',
    '<table><thead><tr><th colspan="2" align="center">h</th></tr></thead><tbody><tr><td colspan="2" rowspan="1" align="left">1</td></tr></tbody></table>',
    '<p>a<br>b<br/>c<br />d</p><hr><hr/>', '<pre>x\n y</pre><code>z</code><h3>t</h3><h4>t</h4><blockquote>q</blockquote><div><p >s</p></div>',
    '<p>$a +\n b$</p>', '<p>a</p>\n<p>b</p>',
    '<img src="' + png + '" width="40" height="40px" alt="рисунок">', '<img src="data:image/jpeg;base64,/9j/4AAQ+Zg==" alt="a &amp; b"/>',
    '<img alt="x" src="data:image/webp;base64,AAAA" /><img src="data:image/gif;base64,R0lGOD==">',
  ];
  for (const html of ok) {
    for (const [field, x] of Object.entries(everyField(html))) {
      const e = errs(x);
      assert.deepEqual(e, [], field + ': ' + JSON.stringify(html));
    }
  }
});

test('a "less than" glued to a letter inside a formula tells the author to write \\lt', () => {
  for (const html of ['<p>$a<b$</p>', '<p>$x<y$</p>']) {
    const x = sample(); x.tasks[0].cond = html;
    assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /\\lt/.test(e)), html);
  }
});

test('the exam title is plain text', () => {
  for (const t of ['a<b', '<b>x</b>', 'x>y']) {
    const x = sample(); x.title = t;
    assert.ok(errs(x).some((e) => /название/i.test(e)), t);
  }
  const ok = sample(); ok.title = 'Пробник 5, вариант 1 &amp; 2';
  assert.deepEqual(errs(ok), []);
});

test('a long-task solution is HTML-checked although it is only a warning', () => {
  const x = sample(); x.key['13'].sol = '<p>ok</p>';
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});

test('formulas with commands that fetch or style things are refused', () => {
  for (const tex of ['\\href{javascript:alert(1)}{x}', '\\url{https://example.com}', '\\htmlClass{a}{x}', '\\htmlId{a}{x}',
    '\\htmlStyle{color:red}{x}', '\\htmlData{a=1}{x}', '\\includegraphics{https://example.com/a.png}', 'a+\\href{x}{y}']) {
    for (const wrap of ['$' + tex + '$', '$$' + tex + '$$']) {
      const x = sample(); x.tasks[0].cond = '<p>' + wrap + '</p>';
      assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /не поддерживается/i.test(e)), wrap);
      const y = sample(); y.key['1'].sol = '<p>' + wrap + '</p>';
      assert.ok(errs(y).some((e) => /задание 1/i.test(e) && /не поддерживается/i.test(e)), wrap);
      const z = sample(); z.key['13'].a = '<p>' + wrap + '</p>';
      assert.ok(errs(z).some((e) => /задание 13/i.test(e) && /не поддерживается/i.test(e)), wrap);
    }
  }
  const ok = sample(); ok.tasks[0].cond = '<p>$\\frac{1}{2}$ и $x\\hspace{1em}y$</p>';
  assert.deepEqual(errs(ok), []);
});

test('an unpaired dollar is a warning, not an error', () => {
  for (const html of ['<p>цена $5</p>', '<p>$a+b</p>', '<p>$$x^2</p>', '<p>$x$ и $</p>']) {
    const x = sample(); x.tasks[0].cond = html;
    const r = V.validateExam(x);
    assert.deepEqual(r.errors, [], html);
    assert.ok(r.warnings.some((w) => /задание 1/i.test(w) && /непарный \$/.test(w)), html);
  }
  const y = sample(); y.key['1'].sol = '<p>$2+3</p>';
  assert.ok(V.validateExam(y).warnings.some((w) => /задание 1/i.test(w) && /непарный \$/.test(w)));
  assert.deepEqual(V.validateExam(sample()).warnings, []);
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

test('extractFormulas works on the text view: entities, escaped dollars, braces, multi-line, tags', () => {
  const f = (h) => V.extractFormulas(h);
  assert.deepEqual(f('<p>$a&lt;b$ и $a&amp;b$ и $x&gt;1$ и $a&nbsp;b$ и $&#60;$ и $&#x3c;$</p>'),
    [{ tex: 'a<b', display: false }, { tex: 'a&b', display: false }, { tex: 'x>1', display: false },
      { tex: 'a\u00a0b', display: false }, { tex: '<', display: false }, { tex: '<', display: false }]);
  assert.deepEqual(f('<p>$a=\\$5$</p>'), [{ tex: 'a=\\$5', display: false }]);
  // KaTeX auto-render does not treat "\$" as an escaped opening delimiter (verified in a real browser):
  assert.deepEqual(f('<p>цена \\$5 и \\$6, а $x$</p>'), [{ tex: '5 и \\$6, а ', display: false }]);
  assert.deepEqual(f('<p>$a +\n b$ и $$c\n=d$$</p>'), [{ tex: 'c\n=d', display: true }, { tex: 'a +\n b', display: false }]);
  assert.deepEqual(f('<p>$\\text{a$b}$ и $\\{x\\}$</p>'), [{ tex: '\\text{a$b}', display: false }, { tex: '\\{x\\}', display: false }]);
  assert.deepEqual(f('<p>$x$</p><p>$y$</p><td>$$z$$</td>'), [{ tex: 'z', display: true }, { tex: 'x', display: false }, { tex: 'y', display: false }]);
  assert.deepEqual(f('<img alt="$z$" src="data:image/png;base64,AA==">'), []);
  assert.deepEqual(f('<p>$x$ <b>$y$</b></p>'), [{ tex: 'x', display: false }, { tex: 'y', display: false }]);
});

test('scanFormulas reproduces what the real KaTeX auto-render renders (browser-verified cases)', () => {
  const pins = JSON.parse(readFileSync(new URL('./fixtures/formula-pins.json', import.meta.url), 'utf8'));
  assert.ok(pins.length >= 40);
  for (const p of pins) {
    assert.deepEqual(V.scanFormulas(p.html).formulas, p.formulas, JSON.stringify(p.html));
    // extractFormulas is the same list with display formulas first
    assert.deepEqual(V.extractFormulas(p.html), p.formulas.filter((f) => f.display).concat(p.formulas.filter((f) => !f.display)), JSON.stringify(p.html));
  }
});

test('formulas written with entities for the dollar, braces or backslash are found and checked', () => {
  for (const d of ['&#36;', '&#x24;', '&dollar;', '&#36']) {
    const x = sample(); x.tasks[0].cond = '<p>' + d + '\\href{javascript:x}{y}' + d + '</p>';
    assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /\\href/.test(e) && /не поддерживается/.test(e)), d);
  }
  const y = sample(); y.tasks[0].cond = '<p>$&bsol;url{x}$ и $&#92;htmlClass{a}{b}$</p>';
  assert.equal(errs(y).filter((e) => /не поддерживается/.test(e)).length, 2);
  // the legacy forms without a semicolon are decoded by the browser, so the validator decodes them too
  assert.deepEqual(V.extractFormulas('<p>$a&ltb$ $a&gtb$ $a&ampb$ $a&quotb$</p>').map((f) => f.tex), ['a<b', 'a>b', 'a&b', 'a"b']);
  assert.deepEqual(V.extractFormulas('<p>&amp;dollar;x&amp;dollar;</p>'), []);
});

test('formulas inside pre and code are not formulas (auto-render skips them)', () => {
  const x = sample(); x.tasks[0].cond = '<p>Код: <code>$\\frac{1$</code> и <pre>$\\href{x}{y}$</pre>.</p>';
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  const y = sample(); y.tasks[0].cond = '<p><code>$x</code> $y$</p>';
  assert.deepEqual(V.validateExam(y).warnings, []);
});

test('extraction stays linear on adversarial input (the old closing search was quadratic)', () => {
  for (const html of ['${'.repeat(80000), '$${'.repeat(80000), '$'.repeat(160000), '$\\'.repeat(80000), '$a$'.repeat(60000) + '$', '<p>${</p>'.repeat(20000)]) {
    const t0 = Date.now();
    V.scanFormulas(html);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, ms + ' ms for ' + html.slice(0, 12));
  }
  const x = sample(); x.tasks[0].cond = '${'.repeat(80000);
  const t0 = Date.now(); V.validateExam(x);
  assert.ok(Date.now() - t0 < 2000);
});

test('worst-case tag soup stays linear (open-elements bookkeeping, every input passes the gate and the size caps)', () => {
  const K = 60000;
  const cases = {
    // popping tens of thousands of open <b> into the "reopen later" list, once per block
    'b-list then blocks': '<p>' + '<b>'.repeat(K) + '<div></div>'.repeat(K),
    // a long reopen list, then many end tags that match nothing open (each one used to scan the list)
    'b-list then stray </i>': '<p>' + '<b>'.repeat(K) + '<div>' + '</i>'.repeat(3 * K),
    'b-list then stray </b>': '<p>' + '<b>'.repeat(K) + '<div>' + '</b>'.repeat(3 * K),
    'nested divs, formatting on top, closed one by one': '<div>'.repeat(K) + '<b>'.repeat(K) + '</div>x'.repeat(K),
    'many open cells and rows': '<table>' + '<tr><td><code>'.repeat(K),
    'many cells with formatting': '<table><tr>' + '<td><i>x'.repeat(K) + '</tr>'.repeat(K),
    'deep <code> inside blocks': '<code>'.repeat(K) + '<ul>'.repeat(K) + '</code>'.repeat(K),
  };
  for (const [name, html] of Object.entries(cases)) {
    let t0 = Date.now();
    V.scanFormulas(html);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, name + ': scanFormulas ' + ms + ' ms');
    const x = sample(); x.tasks[0].cond = html;
    t0 = Date.now();
    V.validateExam(x);
    assert.ok(Date.now() - t0 < 2000, name + ': validateExam ' + (Date.now() - t0) + ' ms');
  }
});

test('an open <code> that a table cell or row end throws away is not reopened after the table', () => {
  assert.deepEqual(V.extractFormulas('<table><tr><td><code>x</td></tr></table>$y$'), [{ tex: 'y', display: false }]);
  assert.deepEqual(V.extractFormulas('<table><tr><td><code>x<td>$a$</td></tr></table>$y$').map((f) => f.tex), ['a', 'y']);
  assert.deepEqual(V.extractFormulas('<table><tr><td><code>x<tr><td>$a$</td></tr></table>$y$').map((f) => f.tex), ['a', 'y']);
  // formatting that was open before the table stays hidden inside a cell and comes back after the table
  assert.deepEqual(V.extractFormulas('<p><code>x</p><table><tr><td>$a$</td></tr></table>$y$').map((f) => f.tex), ['a']);
});

test('a formatting tag closed while a block is open inside it is a warning (the parser reshuffles the tree)', () => {
  for (const html of ['<div><code>y<ul><li>a</li></code></ul></div>', '<b><p>$x$</b></p>']) {
    const x = sample(); x.tasks[0].cond = html;
    const r = V.validateExam(x);
    assert.deepEqual(r.errors, [], html);
    assert.ok(r.warnings.some((w) => /задание 1/i.test(w) && /вложены неправильно/.test(w) && /например, <b> закрыт раньше, чем вложенный в него <p>/.test(w)), html);
  }
  const ok = sample(); ok.tasks[0].cond = '<p><b>a</b> <code>b</code></p><ul><li><i>c</i></li></ul>';
  assert.deepEqual(V.validateExam(ok).warnings, []);
});

test('the unpaired-dollar warning does not advise an escaped dollar outside a formula', () => {
  const x = sample(); x.tasks[0].cond = '<p>цена $5</p>';
  const w = V.validateExam(x).warnings.find((m) => /непарный \$/.test(m));
  assert.ok(w && w.includes('$\\$5$'));
  assert.ok(!w.split('$\\$5$').join('').includes('\\$'), 'no "\\$" advice outside the formula example: ' + w);
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

test('htmlProblem is exported for the teacher panel (the same gate as the upload check)', () => {
  assert.equal(typeof V.htmlProblem, 'function');
  assert.equal(V.htmlProblem('<p>ok</p>'), '');
  assert.notEqual(V.htmlProblem('<img src=x onerror=1>'), '');
  assert.notEqual(V.htmlProblem('<!-- <a title="--><img src=x onerror=1> "> -->'), '');
});
