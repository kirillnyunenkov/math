import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, checkWhen, pickOne, pickExam, linkFromText, checkSolutionUrl } from '../tools/exam-cli-lib.mjs';

test('parseWhen reads Moscow wall time in both spellings', () => {
  assert.equal(parseWhen('2026-10-09 18:00'), 1791558000);
  assert.equal(parseWhen('2026-10-09T18:00'), 1791558000);
  assert.equal(parseWhen('2026-10-10 00:05'), 1791579900);
  assert.equal(parseWhen('9 октября'), null);
  assert.equal(parseWhen(''), null);
});

test('parseWhen refuses rollover and impossible clock times', () => {
  assert.equal(parseWhen('2026-02-31T10:00'), null);
  assert.equal(parseWhen('2026-13-01 10:00'), null);
  assert.equal(parseWhen('2026-04-31 10:00'), null);
  assert.equal(parseWhen('2026-10-09 25:00'), null);
  assert.equal(parseWhen('2026-10-09 18:61'), null);
  assert.equal(parseWhen('2026-10-09 24:00'), null);
  assert.equal(parseWhen('2028-02-29 10:00') > 0, true);   // a real leap day is fine
  assert.equal(parseWhen('2027-02-29 10:00'), null);
});

test('checkWhen bounds the year like the panel: up to 2 years ahead, up to 1 year back', () => {
  const now = parseWhen('2026-10-06 12:00');
  assert.equal(checkWhen('2026-12-01 18:00', now).ts, parseWhen('2026-12-01 18:00'));
  assert.equal(checkWhen('2026-12-01 18:00', now).past, false);
  assert.equal(checkWhen('2026-10-01 18:00', now).past, true);   // past, but allowed (warning)
  assert.equal(checkWhen('2028-06-01 18:00', now).ts > 0, true);
  assert.match(checkWhen('2062-10-09 18:00', now).error, /год/);
  assert.match(checkWhen('2025-01-01 18:00', now).error, /год/);
  assert.match(checkWhen('2026-02-31 10:00', now).error, /ГГГГ-ММ-ДД/);
  assert.match(checkWhen('2026-10-09 25:61', now).error, /ГГГГ-ММ-ДД/);
  assert.match(checkWhen('', now).error, /ГГГГ-ММ-ДД/);
  assert.match(checkWhen('завтра', now).error, /ГГГГ-ММ-ДД/);
});

test('pickOne prefers an exact name, accepts a unique fragment, explains the rest', () => {
  const people = [{ name: 'Иван Петров' }, { name: 'Иван Сидоров' }, { name: 'Мария' }];
  const name = (p) => p.name;
  assert.equal(pickOne(people, 'мария', name).item.name, 'Мария');
  assert.equal(pickOne(people, 'Иван Петров', name).item.name, 'Иван Петров');
  assert.equal(pickOne(people, 'сидор', name).item.name, 'Иван Сидоров');
  const many = pickOne(people, 'иван', name);
  assert.ok(many.error && /Иван Петров/.test(many.error) && /Иван Сидоров/.test(many.error));
  const none = pickOne(people, 'Пётр', name);
  assert.ok(none.error);
  assert.ok(pickOne(people, '  ', name).error);
});

test('pickExam takes a catalog number, "№3" or a title', () => {
  const exams = [{ title: 'Пробник 1' }, { title: 'Пробник 2' }, { title: 'Пробник 10' }];
  const t = (e) => e.title;
  assert.equal(pickExam(exams, '3', t).item.title, 'Пробник 10');
  assert.equal(pickExam(exams, '№1', t).item.title, 'Пробник 1');
  assert.equal(pickExam(exams, ' № 2 ', t).item.title, 'Пробник 2');
  assert.equal(pickExam(exams, 'пробник 10', t).item.title, 'Пробник 10');
  const bad = pickExam(exams, '7', t);
  assert.ok(bad.error && /1/.test(bad.error) && /3/.test(bad.error) && /№1 · Пробник 1/.test(bad.error));
  assert.ok(pickExam(exams, '0', t).error);
  assert.ok(pickExam(exams, 'пробник', t).error);
  assert.ok(pickExam([], '1', t).error);
});

test('pickExam: a title that is a number still resolves as a number first', () => {
  const exams = [{ title: '2' }, { title: '1' }];
  assert.equal(pickExam(exams, '1', (e) => e.title).item.title, '2');
});

test('linkFromText finds the login pair in a pasted teacher link', () => {
  assert.deepEqual(linkFromText('https://x.github.io/math/teacher.html#/login/teacher.AbC123\n'), { login: 'teacher', secret: 'AbC123' });
  assert.equal(linkFromText('nothing here'), null);
});

test('checkSolutionUrl accepts only a plain https link', () => {
  assert.equal(checkSolutionUrl(' https://youtu.be/abc?t=5 ').url, 'https://youtu.be/abc?t=5');
  for (const bad of ['', 'youtu.be/abc', 'http://x.ru/a', 'javascript:alert(1)', 'https://u:p@x.ru/', 'https://x.ru/a b', 'https://x.ru/' + 'a'.repeat(500)])
    assert.ok(checkSolutionUrl(bad).error, bad);
});
