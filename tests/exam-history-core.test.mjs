// tests/exam-history-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const H = createRequire(import.meta.url)('../exam-history-core.js');

// The owner's sheet: eight exams, tasks 1..20 in a column; null = blank, '-' = not in the variant.
const _ = null;
const COLS = [
  [1,1,_,1,1,'-',1,_,_,1,0,1,_,_,_,2,_,_,_,_],
  [1,1,_,1,0,'-',1,1,1,1,1,1,1,2,_,2,_,_,_,1],
  [1,1,1,1,1,'-',1,1,1,1,1,1,1,2,_,2,2,_,0,0],
  [1,1,1,1,1,'-',1,1,1,1,1,1,_,2,_,0,2,_,0,_],
  [1,1,1,1,1,'-',1,1,1,1,1,1,1,2,_,2,2,1,1,_],
  [1,1,1,1,1,'-',1,1,1,1,1,1,1,1,0,0,2,_,4,1],
  [1,1,1,1,1,'-',1,1,1,1,1,1,1,2,_,0,0,0,_,2],
  [1,1,1,1,1,'-',1,1,1,1,1,1,1,0,_,2,2,1,4,1],
];
const item = (col) => {
  const scores = {}, na = [];
  col.forEach((v, i) => { const n = i + 1; if (v === '-') { na.push(n); scores[n] = null; } else scores[n] = v; });
  return { scores, na };
};
const ITEMS = COLS.map(item);

test('primary scores match the owner\'s sheet; an archive exam keeps its own fixed test score', () => {
  assert.deepEqual(ITEMS.map(H.primaryOf), [9, 15, 18, 15, 20, 20, 16, 22]);
  assert.deepEqual(ITEMS.map(H.maxOfItem), Array(8).fill(32));
  assert.deepEqual(ITEMS.map(H.testOf), Array(8).fill(null));                       // no scale converts an old exam: without a fixed score there is none
  const fixed = [52, 76, 82, 76, 86, 86, 78, 90];
  assert.deepEqual(ITEMS.map((it, i) => H.testOf({ ...it, test: fixed[i] })), fixed);
});

test('solvability matches the sheet: blank and "-" are left out of both sums', () => {
  const got = H.NUMS.map((n) => H.solvability(ITEMS, n));
  assert.deepEqual(got, [100, 100, 100, 100, 88, null, 100, 100, 100, 100, 88, 100, 100, 79, 0, 63, 83, 22, 45, 25]);
});

test('cell states', () => {
  const it = ITEMS[5];                                   // column 6 of the sheet
  assert.equal(H.cellState(it, 6), 'na');
  assert.equal(H.cellState(it, 1), 'full');
  assert.equal(H.cellState(it, 14), 'part');             // 1 of 2
  assert.equal(H.cellState(it, 15), 'zero');
  assert.equal(H.cellState(it, 18), 'blank');
  assert.equal(H.cellState({ scores: { 1: 1 }, na: [], maxes: { 1: 3 } }, 1), 'part');   // the item's own maximum wins
});

test('the 32 and 33 scales; other maxima have no computed test score', () => {
  assert.equal(H.SCALE_33.length, 34);
  assert.equal(H.testScore(11, 33), 62);
  assert.equal(H.testScore(33, 33), 100);
  assert.equal(H.testScore(11, 32), 64);
  assert.equal(H.testScore(12, 32), 70);
  assert.equal(H.testScore(5, 20), null);
  assert.equal(H.testScore(-1, 33), null);
});

test('checkTest accepts an integer from 0 to 100', () => {
  assert.equal(H.checkTest(52), '');
  assert.equal(H.checkTest(0), '');
  assert.equal(H.checkTest(100), '');
  for (const bad of [101, -1, 52.5, '52', null, undefined]) assert.match(H.checkTest(bad), /Тестовый балл/);
});

test('the two exam scales are present in the trainer', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = html.match(/const SEC_SCORE=\[([0-9,]+)\]/);
  assert.ok(m, 'SEC_SCORE not found in index.html');
  const values = m[1].split(',').map(Number);
  assert.ok(JSON.stringify(values) === JSON.stringify(H.SCALE_33) || JSON.stringify(values) === JSON.stringify(H.SCALE_32));
});

test('parseScores reads a pasted row of 20 values', () => {
  const r = H.parseScores('1,1,,1,1,-,1,,,1,0,1,,,,2,,,,');
  assert.deepEqual(r.na, [6]);
  assert.equal(H.primaryOf(r), 9);
  assert.equal(r.scores[3], null);
  assert.match(H.parseScores('1,2,3').error, /ровно 20/);
  assert.match(H.parseScores('x' + ',1'.repeat(19)).error, /Задание 1/);
  assert.match(H.parseScores('2' + ',1'.repeat(19)).error, /от 0 до 1/);      // task 1 allows 0..1
  assert.match(H.parseScores(','.repeat(19)).error, /Ни у одного/);
});

test('checkManual refuses points on a task that was not in the variant', () => {
  const scores = {}; H.NUMS.forEach((n) => { scores[n] = null; }); scores[1] = 1; scores[6] = 1;
  assert.match(H.checkManual(scores, [6]), /отсутствующее/);
  assert.equal(H.checkManual(Object.assign({}, scores, { 6: null }), [6]), '');
  assert.match(H.checkManual(scores, [99]), /99/);
});

test('taskScores of an exam written in the trainer', () => {
  const tasks = [{ n: 1, kind: 'short', max: 1 }, { n: 2, kind: 'short', max: 1 }, { n: 3, kind: 'short', max: 1 },
    { n: 14, kind: 'long', max: 2 }, { n: 15, kind: 'long', max: 3 }, { n: 16, kind: 'long', max: 2 }];
  const r = H.taskScores(tasks, { 1: '5', 2: '7' }, { 1: true, 2: false },
    { 14: { pts: 2 }, 15: { pts: 0 }, 16: { pts: 0 } }, ['15']);
  assert.equal(r.scores[1], 1);          // right
  assert.equal(r.scores[2], 0);          // wrong
  assert.equal(r.scores[3], null);       // no answer
  assert.equal(r.scores[14], 2);
  assert.equal(r.scores[15], 0);         // 0 points, but there was a photo: solved wrongly
  assert.equal(r.scores[16], null);      // 0 points and no photo: not solved
  assert.deepEqual(r.na.slice(0, 4), [4, 5, 6, 7]);
  assert.ok(r.na.indexOf(1) < 0 && r.na.indexOf(14) < 0);
  assert.equal(r.maxes[15], 3);
});

test('dates', () => {
  assert.equal(H.validDate('2025-10-21'), true);
  assert.equal(H.validDate('2025-02-30'), false);
  assert.equal(H.validDate('21.10.2025'), false);
  assert.equal(H.dateToTs('2025-10-21'), Date.UTC(2025, 9, 21, 9, 0, 0) / 1000);   // 12:00 Moscow time
});


test('new and old formats map topics without merging the old extra task', () => {
  const old = { scores: { 6: 1, 7: 0, 13: 1, 14: 2 }, na: [] };
  const now = { format: 19, scores: { 6: 1, 12: 0, 13: 1 }, na: [], maxes: { 6: 1, 12: 1, 13: 2 } };
  assert.equal(H.displayNum(old, 6), 7);
  assert.equal(H.displayNum(now, 6), 6);
  assert.equal(H.displaySolvability([old, now], 6), 50);
  assert.equal(H.displaySolvability([old, now], 12), 50);
  assert.equal(H.displaySolvability([old, now], 13), 75);
  assert.equal(H.primaryOf(old), 4);
  assert.equal(H.testOf({ ...now, test: 77 }), 77);
});

test('new full exam summary totals and scores use the 32-point scale', () => {
  const maxima = { 13: 2, 14: 3, 15: 2, 16: 2, 17: 3, 18: 4, 19: 4 };
  const tasks = Array.from({ length: 19 }, (_, i) => {
    const n = i + 1;
    return { n, kind: n < 13 ? 'short' : 'long', max: maxima[n] || 1 };
  });
  const answers = {}, ok = {};
  for (let n = 1; n <= 12; n++) { answers[n] = '1'; ok[n] = true; }
  const row = { ...H.taskScores(tasks, answers, ok, {}, []), format: 19 };
  assert.equal(H.primaryOf(row), 12);
  assert.equal(H.maxOfItem(row), 32);
  assert.equal(H.testOf(row), 70);
  assert.equal(H.displayNum(row, 13), 13);
});
