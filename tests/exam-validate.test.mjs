// tests/exam-validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
    '<img src="data:image/png;charset=x;base64,AA==">',
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

test('the size caps are counted in UTF-8 bytes like the server fields', () => {
  const x = sample(); x.tasks[0].cond = '<p>' + 'a'.repeat(4_900_000) + '</p>';
  assert.ok(errs(x).some((e) => /размер/i.test(e) && /задан/i.test(e)));
  const y = sample(); y.key['1'].sol = '<p>' + 'a'.repeat(1_950_000) + '</p>';
  assert.ok(errs(y).some((e) => /размер/i.test(e) && /ключ/i.test(e)));
  // Cyrillic: under the cap in characters, over it in bytes (2 bytes a letter)
  const c = sample(); c.tasks[0].cond = '<p>' + 'ж'.repeat(2_600_000) + '</p>';
  assert.ok(JSON.stringify(c.tasks).length < 4_800_000 && new TextEncoder().encode(JSON.stringify(c.tasks)).length > 4_800_000);
  assert.ok(errs(c).some((e) => /размер/i.test(e) && /задан/i.test(e)));
  const d = sample(); d.key['1'].sol = '<p>' + 'ж'.repeat(1_000_000) + '</p>';
  assert.ok(JSON.stringify(d.key).length < 1_900_000 && new TextEncoder().encode(JSON.stringify(d.key)).length > 1_900_000);
  assert.ok(errs(d).some((e) => /размер/i.test(e) && /ключ/i.test(e)));
  // and just under the cap in bytes passes
  const ok = sample(); ok.key['1'].sol = '<p>' + 'ж'.repeat(900_000) + '</p>';
  assert.ok(!errs(ok).some((e) => /размер/i.test(e)));
});

test('a part 2 solution is only a warning', () => {
  const x = sample(); x.key['13'].sol = '<p>x</p>';
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});

test('a part 1 key may only hold digits, comma, dot, minus and spaces (what the answer field can type)', () => {
  const run = (a) => { const x = sample(); x.key['1'].a = a; return V.validateExam(x); };
  ['5', '-1,5', '0.5', '−3', '12 345', ' 7 ', '-0,25', '1000'].forEach((a) => assert.deepEqual(run(a).errors, [], a));
  ['очень длинный текст ответа', '1/2', 'x=1', '2;3', '1e5', '5%', '+5', '∞', '1,5 м', '\\frac12', '(1)', '2\u00a0см'].forEach((a) => {
    const e = run(a).errors;
    assert.ok(e.some((m) => /задание 1:/i.test(m) && /цифры, запятая и минус/.test(m)), a + ' -> ' + e.join('|'));
  });
  // tags keep their own, more specific message
  assert.ok(run('<b>5</b>').errors.some((m) => /простым текстом/.test(m)));
  // part 2 answers are HTML and are not subject to the alphabet
  const x = sample(); x.key['13'].a = '<p>$x=\\pm1$, ответ: 2 корня</p>';
  assert.deepEqual(V.validateExam(x).errors, []);
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

// A full exam has the shape of the real one: tasks 1-13 short (1 point each), tasks 14-20 long with the maxima of the
// generator's table (14:2 15:3 16:2 17:2 18:3 19:4 20:4), 33 primary points in all.
const LONG_MAX = { 14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4 };
function fullExam() {
  const tasks = [], key = {};
  for (let n = 1; n <= 20; n++) {
    const long = n >= 14;
    tasks.push({ n, kind: long ? 'long' : 'short', max: long ? LONG_MAX[n] : 1, cond: '<p>Задание ' + n + ': $' + n + '+1$.</p>' });
    key[String(n)] = long ? { a: '<p>$' + (n + 1) + '$</p>' } : { a: String(n + 1), sol: '<p>$' + n + '+1=' + (n + 1) + '$.</p>' };
  }
  return { title: 'Полный', full: true, tasks, key };
}

test('a full exam with the real shape is valid: 13 short + 7 long, 33 points', () => {
  const r = V.validateExam(fullExam());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats, { short: 13, long: 7 });
  assert.equal(fullExam().tasks.reduce((s, t) => s + t.max, 0), 33);
});

test('a full exam must have exactly the tasks 1-20 with the right kinds and maxima', () => {
  let x = fullExam(); x.tasks.pop(); delete x.key['20'];
  assert.ok(errs(x).some((e) => /полный/i.test(e) && /20/.test(e) && /нет задания 20/i.test(e)), 'task 20 missing');
  x = fullExam(); x.tasks.splice(5, 1); delete x.key['6'];
  assert.ok(errs(x).some((e) => /нет задания 6/i.test(e)), 'task 6 missing');
  x = fullExam(); x.tasks.push({ n: 21, kind: 'short', max: 1, cond: '<p>$1$</p>' }); x.key['21'] = { a: '1', sol: '<p>$1$</p>' };
  assert.ok(errs(x).some((e) => /задание 21/i.test(e) && /лишн|только 1.20|не бывает/i.test(e)), 'task 21 extra');
  x = fullExam(); x.tasks[2].kind = 'long'; x.tasks[2].max = 2; x.key['3'] = { a: '<p>$4$</p>' };
  assert.ok(errs(x).some((e) => /задание 3/i.test(e) && /первой части/i.test(e)), 'task 3 must be short');
  x = fullExam(); x.tasks[14].kind = 'short'; x.tasks[14].max = 1; x.key['15'] = { a: '4', sol: '<p>$4$</p>' };
  assert.ok(errs(x).some((e) => /задание 15/i.test(e) && /второй части/i.test(e)), 'task 15 must be long');
  x = fullExam(); x.tasks[18].max = 3;
  assert.ok(errs(x).some((e) => /задание 19/i.test(e) && /4 балл/i.test(e)), 'task 19 is worth 4');
  x = fullExam(); x.tasks[13].max = 3;
  assert.ok(errs(x).some((e) => /задание 14/i.test(e) && /2 балл/i.test(e)), 'task 14 is worth 2');
});

test('only a full exam is held to the real shape; any other exam stays free', () => {
  const x = fullExam(); x.full = false; x.tasks.pop(); delete x.key['20'];
  assert.deepEqual(errs(x), []);
  const y = fullExam(); delete y.full; y.tasks[3].max = 1;
  assert.deepEqual(errs(y), []);
});

// ---- SVG figures: only as <img src="data:image/svg+xml;base64,..."> and only without anything active ----------------
const svgImg = (svg, extra) => '<p><img src="data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64') + '"' + (extra || '') + '></p>';
const SVG_OK = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><path d="M0 0L10 10" stroke="#000" fill="url(#g)"/><use href="#g"/></svg>';

test('an SVG figure is accepted as an image, like the trainer does for its own figures', () => {
  assert.equal(V.htmlProblem(svgImg(SVG_OK, ' width="120" height="80" alt="Рисунок"')), '');
  const x = sample(); x.tasks[0].cond = svgImg(SVG_OK);
  assert.deepEqual(errs(x), []);
});

test('real figures of the task bank pass the SVG gate', () => {
  const dir = new URL('../img/t1/gfx/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).slice(0, 12);
  assert.ok(files.length > 0);
  files.forEach((f) => assert.equal(V.htmlProblem(svgImg(readFileSync(new URL(f, dir), 'utf8'))), '', f));
});

test('an SVG with anything active or external is refused, whatever the spelling', () => {
  const bad = [
    '<svg onload="x()"></svg>', '<svg><circle onclick="x()" r="1"/></svg>', '<svg ONLOAD = "x()"></svg>', "<svg\nonload='x()'></svg>",
    '<svg><script>alert(1)</script></svg>', '<svg><SCRIPT href="x"/></svg>', '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><iframe src="#a"/></svg>', '<svg><animate attributeName="href" to="x"/></svg>', '<svg><set attributeName="onload" to="x()"/></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>', '<svg><image xlink:href="http://example.com/a.png"/></svg>',
    "<svg><use href='//example.com/a.svg#a'/></svg>", '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>', '<svg><image href="data:text/html;base64,PGI+"/></svg>',
    '<svg style="fill:url(https://example.com/a)"></svg>', '<svg><style>@import "x.css";</style></svg>', '<svg><rect fill="url(data:image/png;base64,AA==)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY a "b">]><svg>&a;</svg>', '<?xml-stylesheet href="x.css"?><svg/>', '<!ENTITY a "b"><svg/>',
    '<html><body>not a figure</body></html>', '', 'just text',
  ];
  bad.forEach((b) => assert.notEqual(V.htmlProblem(svgImg(b)), '', JSON.stringify(b)));
  bad.forEach((b) => { const sized = b.replace('<svg', '<svg width="50" height="50"'); assert.notEqual(V.htmlProblem(svgImg(sized)), '', 'sized ' + JSON.stringify(sized)); });
  assert.notEqual(V.htmlProblem('<img src="data:image/svg+xml;base64,@@@">'), '', 'not base64');
  assert.notEqual(V.htmlProblem('<img src="data:image/svg+xml;base64,/w==">'), '', 'not utf-8 text');
  assert.notEqual(V.htmlProblem(svgImg('<svg>' + 'a'.repeat(400001) + '</svg>')), '', 'too big');
});

test('SVG as markup in the text and other SVG-like forms stay refused', () => {
  ['<svg><circle r="1"/></svg>', '<p><svg></svg></p>', '<img src="data:image/svg;base64,AA==">', '<img src="data:image/svg+xml,%3Csvg/%3E">',
    '<img src="data:image/svg+xml;utf8,<svg/>">', '<img src="https://example.com/a.svg">', '<img src="a.svg">',
  ].forEach((b) => assert.notEqual(V.htmlProblem(b), '', b));
});

test('SVG bypasses found in review are refused: prefixed tags, entities, CSS escapes and functions, shadowed attributes', () => {
  const S = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml" width="50" height="50"';
  const bad = [
    S + '><s:script>fetch("/x")</s:script></svg>', S + '><s:foreignObject/></svg>', S + '><s:animate attributeName="href" to="x"/></svg>',
    S + '><h:script>1</h:script></svg>', S + '><ev:listener xmlns:ev="http://www.w3.org/2001/xml-events" event="load"/></svg>',
    S + ' style="background:u&#114;l(http://example.com/a.png)"><rect/></svg>', S + ' style="background:url&#40;http://example.com/a.png)"><rect/></svg>',
    S + "><style>@\\69mport 'http://example.com/a.css';</style></svg>", S + '><style>\\75rl(http://example.com/a.png)</style></svg>',
    S + " style=\"background:image-set('http://example.com/a.png' 1x)\"><rect/></svg>", S + ' style="background:-webkit-image-set(\'http://example.com/a.png\' 1x)"><rect/></svg>',
    S + ' style="background:image(\'http://example.com/a.png\')"><rect/></svg>', S + ' style="background:cross-fade(url(#a), url(#b), 50%)"><rect/></svg>',
    S + "><image id='x href=\"#' href=\"http://example.com/a.png\" width=\"10\" height=\"10\"/></svg>",
    S + '><g id="url(#a" fill="url(https://example.com/x)"/></svg>',
  ];
  bad.forEach((b) => assert.notEqual(V.htmlProblem(svgImg(b)), '', JSON.stringify(b)));
});

test('realistic exports pass: matplotlib with the W3C DOCTYPE, Inkscape with embedded raster, styles in CDATA', () => {
  const matplotlib = '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
    + '<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="460.8pt" height="345.6pt" viewBox="0 0 460.8 345.6" xmlns="http://www.w3.org/2000/svg" version="1.1"><defs><style type="text/css">*{stroke-linejoin: round; stroke-linecap: butt}</style></defs><g id="figure_1"><path d="M 0 0 L 10 10" style="fill: none; stroke: #000000"/><use xlink:href="#m1" x="5" y="5"/></g></svg>';
  const inkscape = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Created with Inkscape (http://www.inkscape.org/) -->\n<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200px" height="100px" viewBox="0 0 200 100" version="1.1"><sodipodi:namedview id="nv" inkscape:zoom="1"/><defs><marker id="m"><path d="M0 0"/></marker></defs><path d="M0 0" style="marker-end:url(#m)"/><image width="4" height="4" xlink:href="data:image/png;base64,iVBORw0KGgo="/></svg>';
  const css = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><style><![CDATA[ .a { fill: #fff; stroke: url(#g); font-family: "DejaVu Sans"; } text:hover { fill: red } @media (prefers-color-scheme: dark) { .a { fill: #000 } } ]]></style><linearGradient id="g"/><text class="a">x &#8722; 1 &amp; 2</text></svg>';
  [matplotlib, inkscape, css].forEach((g, i) => assert.equal(V.htmlProblem(svgImg(g)), '', 'realistic #' + i));
});

test('an SVG without a size on its root tag is refused with a hint (the site shows the SVG at its own size)', () => {
  ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0"/></svg>', '<svg width="50"><path d="M0 0"/></svg>', '<svg height="50"><path d="M0 0"/></svg>',
    '<svg width="100%" height="100%"><path d="M0 0"/></svg>', '<svg width="auto" height="50"><path d="M0 0"/></svg>',
  ].forEach((g) => assert.match(V.htmlProblem(svgImg(g)), /размер|width/i, g));
  ['<svg width="50" height="50"/>', '<svg width="50px" height="30pt"/>', '<svg width=\'12.5\' height=\'7.5\'/>', '<svg\n  width="50"\n  height="50"\n/>'].forEach((g) => assert.equal(V.htmlProblem(svgImg(g)), '', g));
});

test('the SVG gate is linear in time on hostile repetitive input', () => {
  const t0 = Date.now();
  ['url('.repeat(70000), 'href="#'.repeat(50000), ' on'.repeat(130000), '<'.repeat(390000), ' '.repeat(390000)].forEach((junk) => {
    V.htmlProblem(svgImg('<svg width="5" height="5">' + junk + '</svg>'));
  });
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});
