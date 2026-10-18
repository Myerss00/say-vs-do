import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText } from '../src/pipeline.js';
import { createBudget } from '../src/budget.js';

const pricing = { llmInPer1M: 1, llmOutPer1M: 3, tavilyPerSearch: 0.01 };
const ctx = (overrides = {}) => ({
  llm: null,
  search: null,
  budget: createBudget({ maxSessionCostUsd: 2, maxTotalCostUsd: 10 }),
  audit: () => {},
  pricing,
  sessionId: 'latency-test-1',
  ...overrides,
});

test('latency: every result has an integer latency_ms and the response has timing', async () => {
  const out = await checkText({ text: 'Inflation was 2 percent in 2024. Exports grew 5 percent.', mode: 'news' }, ctx());
  assert.ok(out.results.length >= 1);
  for (const r of out.results) {
    assert.ok(Number.isInteger(r.latency_ms) && r.latency_ms >= 0);
  }
  assert.ok(Number.isInteger(out.timing.extract_ms) && out.timing.extract_ms >= 0);
  assert.ok(out.timing.total_ms >= out.timing.extract_ms);
});

test('latency: a slow search is reflected in latency_ms', async () => {
  const slowSearch = async () => {
    await new Promise((r) => setTimeout(r, 60));
    return [{ title: 't', url: 'https://ok.example/a', content: 'c' }];
  };
  const out = await checkText({ text: 'Inflation was 2 percent in 2024.', mode: 'news' }, ctx({ search: slowSearch }));
  assert.ok(out.results[0].latency_ms >= 50, `got ${out.results[0].latency_ms}`);
});

test('latency: budget-capped claims still report latency_ms', async () => {
  const budget = createBudget({ maxSessionCostUsd: 0, maxTotalCostUsd: 10 });
  const out = await checkText({ text: 'Inflation was 2 percent in 2024.', mode: 'news' }, ctx({ budget }));
  assert.equal(out.results[0].verdict, 'UNVERIFIABLE');
  assert.ok(Number.isInteger(out.results[0].latency_ms));
});
