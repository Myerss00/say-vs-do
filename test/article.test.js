import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isArticleUrl, cleanArticleText, createArticleReader, ArticleError, MAX_ARTICLE_CHARS } from '../src/article.js';
import { checkText } from '../src/pipeline.js';
import { createBudget } from '../src/budget.js';
import { createApp } from '../src/server.js';
import { createAuditLog } from '../src/audit.js';

// ---------- which inputs count as a news link ----------
test('article: a single public http(s) link is a news link', () => {
  assert.equal(isArticleUrl('https://www.europarl.europa.eu/topics/es/article/2022'), true);
  assert.equal(isArticleUrl('  http://news.example.com/a?b=1  '), true);
});

test('article: text with a link inside, other schemes and private hosts are NOT read', () => {
  for (const bad of [
    'Mira esto https://news.example.com/a', // text + link -> normal text check
    'ftp://news.example.com/a',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://localhost:3000/api/status',
    'http://127.0.0.1/admin',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
    'https://user:pass@news.example.com/a',
    `https://news.example.com/${'a'.repeat(2100)}`,
  ]) {
    assert.equal(isArticleUrl(bad), false, bad);
  }
});

test('article: markdown is cleaned to plain text and capped', () => {
  const out = cleanArticleText('# Title\n\n![img](https://x/y.png) Text with [a link](https://x/z) and **bold**.\n\n\nMore https://x/q');
  assert.equal(out.includes('!['), false);
  assert.equal(out.includes('https://'), false);
  assert.ok(out.includes('a link'));
  assert.ok(out.includes('bold'));
  assert.ok(cleanArticleText('x'.repeat(10_000)).length <= MAX_ARTICLE_CHARS);
});

// ---------- the Tavily Extract reader ----------
const liveConfig = { search: { mock: false, apiKey: 'tvly-test' }, limits: { timeoutMs: 1000, maxRetries: 0 } };

test('article reader: returns title + text and sends the key only to Tavily', async () => {
  const calls = [];
  const read = createArticleReader(liveConfig, {
    postJsonImpl: async (url, opts) => {
      calls.push({ url, body: opts.body });
      return { results: [{ url: 'https://n.example/a', title: 'EU bans new petrol cars', raw_content: '# EU\nAll new cars sold from 2035 must be zero emission.' }] };
    },
  });
  const page = await read('https://n.example/a');
  assert.equal(page.title, 'EU bans new petrol cars');
  assert.ok(page.text.includes('2035'));
  assert.equal(calls[0].url, 'https://api.tavily.com/extract');
  assert.deepEqual(calls[0].body.urls, ['https://n.example/a']);
});

test('article reader: service failure -> ArticleError 502; empty page -> ArticleError 422', async () => {
  const failing = createArticleReader(liveConfig, {
    postJsonImpl: async () => {
      throw new Error('timeout');
    },
  });
  await assert.rejects(failing('https://n.example/a'), (e) => e instanceof ArticleError && e.status === 502);
  const empty = createArticleReader(liveConfig, { postJsonImpl: async () => ({ results: [], failed_results: [{ url: 'x' }] }) });
  await assert.rejects(empty('https://n.example/a'), (e) => e instanceof ArticleError && e.status === 422);
});

test('article reader: mock mode (no Tavily key) -> null', () => {
  assert.equal(createArticleReader({ search: { mock: true }, limits: {} }), null);
});

// ---------- pipeline + API ----------
const pricing = { llmInPer1M: 1, llmOutPer1M: 3, tavilyPerSearch: 0.01 };
const ctx = (o) => ({ budget: createBudget({ maxSessionCostUsd: 2, maxTotalCostUsd: 10 }), audit: () => {}, pricing, sessionId: 'article-test-1', llm: null, search: null, ...o });

test('pipeline: a link is read and its article text is checked; article is returned', async () => {
  let seenText;
  const readArticle = async (url) => ({ url, title: 'Report', text: 'Report\nUnemployment fell to 3 percent in 2025.' });
  const out = await checkText({ text: 'https://n.example/report', mode: 'news' }, ctx({ readArticle, llm: async (m) => ((seenText = m[1].content), { content: '{"claims":[]}', usage: { input: 1, output: 1 } }) }));
  assert.deepEqual(out.article, { url: 'https://n.example/report', title: 'Report' });
  assert.ok(seenText.includes('Unemployment fell to 3 percent'), 'the article text, not the URL, reaches the extractor');
  assert.ok(seenText.includes('<untrusted_data'), 'article text is wrapped as untrusted data');
});

test('pipeline: a link without a reader (mock mode) -> clear ArticleError 400', async () => {
  await assert.rejects(checkText({ text: 'https://n.example/report', mode: 'news' }, ctx({})), (e) => e instanceof ArticleError && e.status === 400);
});

test('pipeline: normal text is never sent to the article reader', async () => {
  let called = false;
  const readArticle = async () => ((called = true), null);
  await checkText({ text: 'Inflation was 2 percent in 2024.', mode: 'news' }, ctx({ readArticle }));
  assert.equal(called, false);
});

const servers = [];
after(() => servers.forEach((s) => s.close()));

test('api: a link in mock mode returns 400 with a readable message', async () => {
  const app = createApp({
    config: { limits: { maxSessionCostUsd: 2, maxTotalCostUsd: 10, maxClaimsPerRequest: 5 }, pricing },
    llm: null,
    search: null,
    budget: createBudget({ maxSessionCostUsd: 2, maxTotalCostUsd: 10 }),
    audit: createAuditLog(mkdtempSync(path.join(tmpdir(), 'svd-audit-'))),
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'article-api-test-1' },
    body: JSON.stringify({ text: 'https://n.example/report' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /TAVILY_API_KEY/);
});
