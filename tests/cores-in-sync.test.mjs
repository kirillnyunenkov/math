// tests/cores-in-sync.test.mjs
// The server loads copies of the shared files from backend/pb_hooks/lib/.
// After editing a shared file run: cp answers-core.js exam-core.js exam-history-core.js backend/pb_hooks/lib/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const f of ['answers-core.js', 'exam-core.js', 'exam-history-core.js']) {
  test(`backend/pb_hooks/lib/${f} is identical to ${f}`, () => {
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.equal(read(`../backend/pb_hooks/lib/${f}`), read(`../${f}`));
  });
}
