import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, pickOne, pickExam, linkFromText } from '../tools/exam-cli-lib.mjs';

test('parseWhen reads Moscow wall time in both spellings', () => {
  assert.equal(parseWhen('2026-10-09 18:00'), 1791558000);
  assert.equal(parseWhen('2026-10-09T18:00'), 1791558000);
  assert.equal(parseWhen('2026-10-10 00:05'), 1791579900);
  assert.equal(parseWhen('9 октября'), null);
  assert.equal(parseWhen(''), null);
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
