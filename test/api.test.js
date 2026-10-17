// HTTP-level tests against the real Express app in mock mode (no network, no keys).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createBudget } from '../src/budget.js';
import { createAuditLog } from '../src/audit.js';

const config = {
  limits: { maxSessionCostUsd: 2, maxTotalCostUsd: 10, maxClaimsPerRequest: 5 },
  pricing: { llmInPer1M: 1, llmOutPer1M: 3, tavilyPerSearch: 0.01 },
};
const auditDir = mkdtempSync(path.join(tmpdir(), 'svd-audit-'));
const servers = [];

async function start(overrides = {}) {
  const app = createApp({
    config,
    llm: null,
    search: null,
    budget: createBudget(config.limits),
    audit: createAuditLog(auditDir),
    ...overrides,
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}`;
}
after(() => servers.forEach((s) => s.close()));

const post = (base, body, headers = { 'X-Session-Id': 'test-session-1234' }) =>
  fetch(`${base}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('api: mock check returns verdict cards marked as mock', async () => {
  const base = await start();
  const res = await post(base, { text: 'Unemployment fell to 3 percent in 2025. Nice weather today.', mode: 'news', lang: 'en-US' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.mock, { llm: true, search: true });
  assert.ok(data.results.length >= 1);
  const r = data.results[0];
  // Mock mode must never present a real-looking verdict.
  assert.equal(r.demo, true);
  assert.equal(r.verdict, 'UNVERIFIABLE');
  assert.equal(r.confidence, null);
  assert.match(r.explanation, /DEMO/);
  assert.ok(r.sources.every((s) => !('content' in s)), 'raw source content is not sent to the browser');
});

test('api: oversized text (5001 chars) is rejected with 400', async () => {
  const base = await start();
  const res = await post(base, { text: 'a'.repeat(5001) });
  assert.equal(res.status, 400);
});

test('api: very large body is rejected with 413 before parsing', async () => {
  const base = await start();
  const res = await post(base, { text: 'a'.repeat(40_000) });
  assert.equal(res.status, 413);
});

test('api: invalid JSON and missing session id are rejected with 400', async () => {
  const base = await start();
  assert.equal((await post(base, '{bad json')).status, 400);
  assert.equal((await post(base, { text: 'valid text here' }, {})).status, 400);
});

test('api: session budget reached -> 429', async () => {
  const base = await start({ budget: createBudget({ maxSessionCostUsd: 0, maxTotalCostUsd: 10 }) });
  const res = await post(base, { text: 'Inflation was 2 percent in 2024.' });
  assert.equal(res.status, 429);
});

test('api: rate limit returns 429 after the limit', async () => {
  const base = await start({ rateLimitPerMin: 2 });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await fetch(`${base}/api/status`)).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('api: security headers from helmet are present', async () => {
  const base = await start();
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'self'"));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});
