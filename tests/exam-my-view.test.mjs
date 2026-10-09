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
  assert.match(h, /my-c my-zero[^>]*">0</);
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

// Drills (full: false) may be numbered 1..40: they are listed, but never mapped onto the 20 task rows.
const D = mk('d', Date.UTC(2025, 11, 1, 9) / 1000, 1, { full: false });

test('drills stay out of the table, solvability and chart; the list shows them with the primary score only', () => {
  const full = { ...A, full: true };
  const t = V.tableHtml([full, D]);
  assert.match(t, /01\.12|21\.10/);
  assert.doesNotMatch(t, /01\.12/);                                          // no column for the drill
  assert.match(t, />100%</);                                                 // task 1: 1 of 1 over the full exam only
  assert.equal(V.chartHtml([full, D]), '');                                  // one full exam is not a chart
  assert.match(V.chartHtml([full, { ...B, full: true }, D]), /<svg/);
  assert.doesNotMatch(V.chartHtml([full, { ...B, full: true }, D]), /01\.12/);
  const l = V.listHtml([full, D], []);
  assert.match(l, /Вариант d/);
  const row = l.split('my-row').filter((x) => x.includes('Вариант d'))[0];
  assert.doesNotMatch(row, /тест/);
  assert.match(row, / из /);
  assert.match(l, /тест 11/);                                                // the full exam keeps its test score
});

test('only drills: the list stays, the chart and the table cards are skipped', () => {
  const h = V.pageHtml([D], { seen: [] });
  assert.match(h, /data-exam="d"/);
  assert.doesNotMatch(h, /my-tbl|<svg|Баллы по заданиям|Тестовый балл/);
});

test('top block (exams still ahead) is placed under the title, also in the empty state', () => {
  const top = '<section class="my-card"><h3>Ждут тебя</h3></section>';
  assert.match(V.pageHtml([A, B], { seen: [], top }), /Мои пробники[\s\S]*Ждут тебя[\s\S]*Тестовый балл/);
  assert.match(V.pageHtml([], { seen: [], top }), /Здесь появятся[\s\S]*Ждут тебя/);
});

test('teacher view: the same dashboard, no "Открыть" buttons, the wording is about the student', () => {
  const E = mk('c', Date.UTC(2025, 11, 1, 9) / 1000, 1, { test: undefined });
  const h = V.dashboardHtml([A, B, E], { readonly: true });
  assert.match(h, /my-tbl/);
  assert.match(h, /<svg/);
  assert.match(h, /ученик набрал/);
  assert.match(h, /тест 11/);                                              // the final score is in the list
  assert.doesNotMatch(h, /data-exam=|Открыть/);
  assert.match(V.pageHtml([A, B], { seen: [] }), /data-exam="a"/);        // the student page keeps its buttons
});

test('table polish: second-part divider, tinted weak tasks, only the newest date marked; no trend, no shaded partial scores', () => {
  const mkp = (id, date, s15, test) => { const x = mk(id, date, 1, { test }); x.scores[15] = s15; return x; };
  const C = mkp('c', 1000000, 1, 60), D = mkp('d', 2000000, 2, 70), E = mkp('e', 3000000, 0, 64);
  const h = V.tableHtml([C, D, E]);
  assert.match(h, /<tr class="my-p2"><th class="my-n">14</);                  // before task 14
  assert.match(h, /<tr class="my-total my-p2">/);                              // and before the totals
  assert.equal((h.match(/my-last/g) || []).length, 1);                         // the date of the newest exam only
  assert.doesNotMatch(V.tableHtml([C]), /my-last/);                            // one exam: nothing to compare
  assert.match(h, /my-sol my-sm">50%</);                                      // task 15: 3 of 6 points, a middling task is tinted
  assert.match(h, /my-c my-part">1</);                                        // partial scores stay one plain colour
  assert.doesNotMatch(h, /my-pl|my-ph|my-up|my-dn|<small/);
});
