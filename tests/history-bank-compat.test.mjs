import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const excerpt = source.slice(source.indexOf('function packBits('), source.indexOf('function mergeHistory('));
const tools = source.slice(source.indexOf('function historyNew('), source.indexOf('function histCells('));
const context = vm.createContext({ btoa, atob, loadHistory: () => context.history,
  secondaryScore: n => n + 1000, legacySecondaryScore: n => n + 2000 });
vm.runInContext(excerpt + tools, context);

test('history links preserve each record bank and apply its own score scale', () => {
  context.history = [
    {t: 1800000000000, p: 12, total: 20, m: 33, ms: 4000, q: [[7,2,1,'']]},
    {t: 1800000060000, p: 12, total: 19, m: 32, ms: 4000, q: [[6,2,1,''],[0,0,0,'bank19']]}
  ];
  const decoded = context.histDecode(context.histEncode());
  assert.equal(decoded[0].s, 2012);
  assert.equal(decoded[1].s, 1012);
  assert.equal(context.historyNew(decoded[0]), false);
  assert.equal(context.historyNew(decoded[1]), true);
  assert.equal(context.histDisplayNumber(decoded[0],7),6);
  assert.equal(context.histDisplayNumber(decoded[0],6),null);
  assert.equal(context.histDisplayNumber(decoded[1],6),6);
});

test('a pre-change history link uses the 33-point scale', () => {
  const bits = [[3,8],[1,8],[30000000,32],[0,20],[12,6],[20,6],[33,6],[10,14],[1,6],[7,5],[2,11],[1,3]];
  const encoded = context.bytesToB64(context.packBits(bits));
  const decoded = context.histDecode(encoded);
  assert.equal(decoded[0].s, 2012);
  assert.equal(context.historyNew(decoded[0]), false);
  assert.equal(decoded[0].q[0][0],7);
});
