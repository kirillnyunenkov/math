// tests/exam-check.test.mjs — the library behind tools/exam_check.mjs (validation + KaTeX rendering)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExam } from '../tools/exam-check-lib.mjs';
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/exam-sample.json', import.meta.url), 'utf8'));

test('the sample exam passes the full check', () => {
  const r = checkExam(sample());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats, { short: 2, long: 1 });
});

test('formulas written with entities and escapes render', () => {
  const x = sample();
  x.tasks[0].cond = '<p>Если $a&lt;b$ и $a \\lt b$, то $a\\&amp;b$ и $x&gt;1$; цена $\\$5$, $a&ltb$ и $a=\\$5$.</p>';
  x.key['1'].sol = '<p>$$\\dfrac{1}{2}\n+\\dfrac{1}{3}$$</p>';
  assert.deepEqual(checkExam(x).errors, []);
});

test('a formula the platform leaves as plain text (no closing dollar at brace depth 0) is a warning, not an error', () => {
  const x = sample(); x.tasks[0].cond = '<p>$\\frac{1$</p>';
  const r = checkExam(x);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /задание 1/i.test(w) && /непарный \$/.test(w)));
});

test('formulas inside code and pre are not rendered by the platform, so they are not checked', () => {
  const x = sample(); x.tasks[0].cond = '<p><code>$\\frac{1$</code></p>';
  assert.deepEqual(checkExam(x).errors, []);
});

test('a formula whose dollars are entities is still checked', () => {
  const x = sample(); x.tasks[0].cond = '<p>&#36;\\badmacro{1}&#36;</p>';
  assert.ok(checkExam(x).errors.some((e) => /задание 1/i.test(e) && /не рисуется/.test(e)));
});

test('a formula that does not render is an error', () => {
  const x = sample(); x.tasks[2].cond = '<p>$$x^2=\\badmacro{1}$$</p>';
  assert.ok(checkExam(x).errors.some((e) => /задание 13/i.test(e) && /не рисуется/.test(e)));
  const y = sample(); y.key['2'].sol = '<p>$\\frac{1}$</p>';
  assert.ok(checkExam(y).errors.some((e) => /задание 2/i.test(e)));
});

test('\\href and friends are errors even though KaTeX only renders them as plain text', () => {
  const x = sample(); x.tasks[0].cond = '<p>$\\href{javascript:alert(1)}{x}$</p>';
  assert.ok(checkExam(x).errors.some((e) => /задание 1/i.test(e) && /\\href/.test(e) && /не поддерживается/.test(e)));
});

test('the unsafe-HTML gate is part of the check', () => {
  const x = sample(); x.tasks[0].cond = '<!-- <a title="--><img src=x onerror=alert(1)> "> -->';
  assert.ok(checkExam(x).errors.some((e) => /html/i.test(e)));
});

test('broken formulas are reported for the first 30 only, plus a summary line', () => {
  const x = sample(); x.tasks[0].cond = '<p>' + '$\\badmacro{1}$ '.repeat(100) + '</p>';
  const r = checkExam(x);
  assert.equal(r.errors.length, 31);
  assert.equal(r.errors.filter((e) => /не рисуется/.test(e)).length, 30);
  assert.match(r.errors[30], /…и ещё 70 формул не рисуются/);
  const y = sample(); y.tasks[0].cond = '<p>' + '$\\badmacro{1}$ '.repeat(30) + '</p>';
  assert.equal(checkExam(y).errors.length, 30);
});
