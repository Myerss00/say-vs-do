import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScore, addResults, scoreShares } from '../public/score.js';

test('score: counts each verdict and the total', () => {
  const s = addResults(emptyScore(), [
    { verdict: 'SUPPORTED' },
    { verdict: 'FALSE' },
    { verdict: 'FALSE' },
    { verdict: 'MISLEADING' },
    { verdict: 'UNVERIFIABLE' },
  ]);
  assert.deepEqual(s, { SUPPORTED: 1, MISLEADING: 1, FALSE: 2, UNVERIFIABLE: 1, demo: 0, total: 5 });
});

test('score: demo results are counted apart, never as verdicts', () => {
  const s = addResults(emptyScore(), [{ verdict: 'UNVERIFIABLE', demo: true }, { verdict: 'SUPPORTED' }]);
  assert.equal(s.demo, 1);
  assert.equal(s.UNVERIFIABLE, 0);
  assert.equal(s.total, 1);
});

test('score: unknown verdicts count as UNVERIFIABLE, junk entries are skipped', () => {
  const s = addResults(emptyScore(), [{ verdict: 'TRUE' }, null, 'x']);
  assert.equal(s.UNVERIFIABLE, 1);
  assert.equal(s.total, 1);
});

test('score: addResults does not mutate and accumulates across calls', () => {
  const a = emptyScore();
  const b = addResults(a, [{ verdict: 'FALSE' }]);
  const c = addResults(b, [{ verdict: 'FALSE' }]);
  assert.equal(a.FALSE, 0);
  assert.equal(c.FALSE, 2);
});

test('score: shares are percentages and 0 with no verdicts', () => {
  assert.deepEqual(scoreShares(emptyScore()), { SUPPORTED: 0, MISLEADING: 0, FALSE: 0, UNVERIFIABLE: 0 });
  const s = addResults(emptyScore(), [{ verdict: 'SUPPORTED' }, { verdict: 'FALSE' }, { verdict: 'FALSE' }, { verdict: 'FALSE' }]);
  assert.deepEqual(scoreShares(s), { SUPPORTED: 25, MISLEADING: 0, FALSE: 75, UNVERIFIABLE: 0 });
});
