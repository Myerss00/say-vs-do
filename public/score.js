// "Dice vs. Hace" session score. Pure functions: used by app.js and by node tests.
export const SCORE_KEYS = ['SUPPORTED', 'MISLEADING', 'FALSE', 'UNVERIFIABLE'];

export function emptyScore() {
  return { SUPPORTED: 0, MISLEADING: 0, FALSE: 0, UNVERIFIABLE: 0, demo: 0, total: 0 };
}

// Returns a new score. Demo (mock) results are counted apart: they are not real verdicts.
export function addResults(score, results = []) {
  const next = { ...score };
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    if (r.demo) {
      next.demo += 1;
      continue;
    }
    const key = SCORE_KEYS.includes(r.verdict) ? r.verdict : 'UNVERIFIABLE';
    next[key] += 1;
    next.total += 1;
  }
  return next;
}

// Share of each verdict among real verdicts, as whole percentages (0 when there are none).
export function scoreShares(score) {
  const shares = {};
  for (const k of SCORE_KEYS) shares[k] = score.total ? Math.round((score[k] / score.total) * 100) : 0;
  return shares;
}
