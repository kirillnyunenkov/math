import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const V = createRequire(import.meta.url)('../exam-my-view.js');

const mk = (id, date, score1, extra = {}) => {
  const scores = {}; for (let n = 1; n <= 20; n++) scores[n] = null;
  scores[1] = score1; scores[14] = 1;
  return { kind: 'exam', id, title: 'Вариант ' + id, date, scores, na: [6], test: 11, ...extra };   // test: the fixed score of an archive exam
};
const A = mk('a', Date.UTC(2025, 9, 21, 9) / 1000, 1), B = mk('b', Date.UTC(2025, 10, 15, 9) / 1000, 0, { kind: 'manual' });

test('empty state: no dashboard, one friendly line', () => {
  const h = V.pageHtml([], { seen: [] });
  assert.match(h, /Здесь появятся твои пробники/);
  assert.doesNotMatch(h, /my-tbl|<svg/);
});

test('table: a row per task, coloured cells, "-" for a task that was not there, solvability and totals', () => {
  const h = V.tableHtml([A, B]);
  assert.match(h, /my-tbl/);
  assert.equal((h.match(/<tr/g) || []).length, 1 + 20 + 2);                  // header + 20 tasks + primary + test
  assert.match(h, /my-c my-full">1</);
  assert.match(h, /my-c my-zero">0</);
  assert.match(h, /my-c my-part">1</);                                       // task 14: 1 of 2
  assert.match(h, /my-c my-na">-</);
  assert.match(h, />50%</);                                                  // task 1: 1 of 2 over two exams
  assert.match(h, /21\.10/);
});

test('chart needs two exams with a test score', () => {
  assert.equal(V.chartHtml([A]), '');
  assert.match(V.chartHtml([A, B]), /<svg/);                                  // both carry a fixed test score
  const bare = (it) => ({ ...it, test: undefined });                           // maximum 32 and no fixed score: nothing to plot
  assert.equal(V.chartHtml([bare(A), bare(B)]), '');
});

test('list: exams written here open, manual ones are labelled, unseen ones are marked', () => {
  const h = V.listHtml([A, B], ['b']);
  assert.match(h, /data-exam="a"/);
  assert.doesNotMatch(h, /data-exam="b"/);
  assert.match(h, /записан вручную/);
  assert.match(h, /my-new/);                                                 // a is not in `seen`
  assert.equal((V.listHtml([A], ['a']).match(/my-new/g) || []).length, 0);
});

test('titles are escaped', () => {
  const h = V.listHtml([{ ...A, title: '<b>x</b>' }], []);
  assert.doesNotMatch(h, /<b>x/);
});
