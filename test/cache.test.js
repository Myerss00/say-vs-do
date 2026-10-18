import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCache, normalizeText, cacheKey } from '../src/cache.js';
import { checkText } from '../src/pipeline.js';
import { createBudget } from '../src/budget.js';
import { EXTRACT_SYSTEM } from '../src/prompts.js';

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'svd-cache-')), 'claims.json');
const verdict = { verdict: 'MISLEADING', confidence: 0.7, explanation: 'Close: 59%.', source_url: 'https://energy.example/r', sources: [{ title: 'R', url: 'https://energy.example/r' }] };

// ---------- the store ----------
test('cache: normalization ignores case, accents, quotes, punctuation and spacing', () => {
  assert.equal(normalizeText('«Germany  produced 60 %!»'), normalizeText('germany produced 60%'));
  assert.equal(normalizeText('Énergie Verte.'), 'energie verte');
  assert.equal(cacheKey('c', 'news', 'A b.'), cacheKey('c', 'news', 'a B'));
  assert.notEqual(cacheKey('c', 'news', 'a b'), cacheKey('c', 'corporate', 'a b'), 'mode is part of the key');
});

test('cache: values survive a restart (written atomically to the JSON file)', async () => {
  const file = tmpFile();
  const a = createCache({ file });
  await a.setClaim('news', 'Germany produced 60% in 2025.', verdict);
  const b = createCache({ file });
  const hit = b.getClaim('news', 'germany produced 60 % in 2025');
  assert.deepEqual(hit.value, verdict);
  assert.match(hit.cachedAt, /^\d{4}-\d{2}-\d{2}T/);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.version, 1);
  assert.ok(Object.keys(raw.entries).every((k) => /^[0-9a-f]{64}$/.test(k)), 'keys are hashes, not raw text');
});

test('cache: entries expire after the TTL', async () => {
  let t = Date.parse('2026-10-18T10:00:00Z');
  const c = createCache({ file: tmpFile(), ttlMs: 1000, now: () => t });
  await c.setClaim('news', 'x claim', verdict);
  assert.ok(c.getClaim('news', 'x claim'));
  t += 2000;
  assert.equal(c.getClaim('news', 'x claim'), null);
});

test('cache: oldest entries are evicted beyond maxEntries', async () => {
  const c = createCache({ file: tmpFile(), maxEntries: 2 });
  c.setClaim('news', 'one', verdict);
  c.setClaim('news', 'two', verdict);
  await c.setClaim('news', 'three', verdict);
  assert.equal(c.size(), 2);
  assert.equal(c.getClaim('news', 'one'), null);
  assert.ok(c.getClaim('news', 'three'));
});

test('cache: a corrupted or foreign file is ignored, not trusted', () => {
  const file = tmpFile();
  writeFileSync(file, '{not json');
  assert.equal(createCache({ file }).size(), 0);
  writeFileSync(file, JSON.stringify({ version: 1, entries: { 'not-a-hash': { t: 'x', v: {} } } }));
  assert.equal(createCache({ file }).size(), 0);
});

test('cache: returned values are copies (callers cannot corrupt the cache)', async () => {
  const c = createCache({ file: tmpFile() });
  await c.setClaim('news', 'claim', verdict);
  c.getClaim('news', 'claim').value.verdict = 'SUPPORTED';
  assert.equal(c.getClaim('news', 'claim').value.verdict, 'MISLEADING');
});

// ---------- pipeline rules ----------
const CLAIM = 'Germany produced 60% of its electricity from renewables in 2025.';
const pricing = { llmInPer1M: 1, llmOutPer1M: 3, tavilyPerSearch: 0.01 };

function liveLlm({ judgeReply = JSON.stringify({ verdict: 'MISLEADING', confidence: 0.7, explanation: 'Close: 59%.', source_url: 'https://energy.example/r' }) } = {}) {
  const calls = { extract: 0, judge: 0 };
  const llm = async (messages) => {
    const isExtract = messages[0].content === EXTRACT_SYSTEM;
    calls[isExtract ? 'extract' : 'judge']++;
    const content = isExtract ? JSON.stringify([{ claim: CLAIM, type: 'news', language: 'en' }]) : judgeReply;
    return { content, usage: { input: 10, output: 5 } };
  };
  return { llm, calls };
}
const okSearch = async () => [{ title: 'R', url: 'https://energy.example/r', content: 'Renewables reached 59%.' }];
const downLlm = async () => {
  throw new Error('network down');
};
const downSearch = async () => {
  throw new Error('network down');
};
const ctx = (o) => ({ budget: createBudget({ maxSessionCostUsd: 2, maxTotalCostUsd: 10 }), audit: () => {}, pricing, sessionId: 'cache-test-1', ...o });

test('pipeline+cache: a repeated text returns the real verdict instantly even with the network down', async () => {
  const cache = createCache({ file: tmpFile() });
  const { llm } = liveLlm();
  const first = await checkText({ text: `Speech: ${CLAIM}`, mode: 'news' }, ctx({ llm, search: okSearch, cache }));
  assert.equal(first.results[0].verdict, 'MISLEADING');
  assert.equal(first.results[0].cached, undefined);
  await cache.flush();

  const again = await checkText({ text: `speech:  ${CLAIM.toUpperCase()}`, mode: 'news' }, ctx({ llm: downLlm, search: downSearch, cache }));
  assert.equal(again.results.length, 1);
  assert.equal(again.results[0].verdict, 'MISLEADING');
  assert.equal(again.results[0].cached, true);
  assert.equal(again.results[0].source_url, 'https://energy.example/r');
  assert.equal(again.timing.extract_ms, 0);
});

test('pipeline+cache: a known claim inside a new text skips search and judge', async () => {
  const cache = createCache({ file: tmpFile() });
  await checkText({ text: CLAIM, mode: 'news' }, ctx({ ...liveLlm(), search: okSearch, cache }));
  const { llm, calls } = liveLlm();
  let searched = 0;
  const countingSearch = async (q) => (searched++, okSearch(q));
  const out = await checkText({ text: `Different intro. ${CLAIM}`, mode: 'news' }, ctx({ llm, search: countingSearch, cache }));
  assert.equal(calls.extract, 1);
  assert.equal(calls.judge, 0);
  assert.equal(searched, 0);
  assert.equal(out.results[0].cached, true);
});

test('pipeline+cache: mock mode never reads or writes the cache (no fake verdicts)', async () => {
  const cache = createCache({ file: tmpFile() });
  await cache.setText('news', CLAIM, { results: [{ claim: CLAIM, type: 'news', language: 'en', ...verdict }] });
  await cache.setClaim('news', CLAIM, { claim: CLAIM, type: 'news', language: 'en', ...verdict });
  const before = cache.size();
  for (const mocks of [{ llm: null, search: null }, { llm: liveLlm().llm, search: null }, { llm: null, search: okSearch }]) {
    const out = await checkText({ text: CLAIM, mode: 'news' }, ctx({ ...mocks, cache }));
    if (!mocks.llm) {
      assert.equal(out.results[0].demo, true, 'mock LLM still shows a DEMO card');
      assert.equal(out.results[0].verdict, 'UNVERIFIABLE');
    }
    assert.ok(out.results.every((r) => !r.cached));
  }
  assert.equal(cache.size(), before, 'nothing new was written');
});

test('pipeline+cache: fallbacks from invalid model output are not cached', async () => {
  const cache = createCache({ file: tmpFile() });
  await checkText({ text: CLAIM, mode: 'news' }, ctx({ ...liveLlm({ judgeReply: 'not json' }), search: okSearch, cache }));
  assert.equal(cache.size(), 0);
});

test('pipeline+cache: verdicts without evidence (search failed) are not cached', async () => {
  const cache = createCache({ file: tmpFile() });
  const out = await checkText({ text: CLAIM, mode: 'news' }, ctx({ ...liveLlm(), search: downSearch, cache }));
  assert.equal(out.results.length, 1);
  assert.equal(cache.size(), 0);
});

test('pipeline+cache: without a cache the pipeline behaves as before', async () => {
  const out = await checkText({ text: CLAIM, mode: 'news' }, ctx({ ...liveLlm(), search: okSearch }));
  assert.equal(out.results[0].verdict, 'MISLEADING');
  assert.ok(!('cacheable' in out.results[0]), 'internal flags do not leak to the client');
});
