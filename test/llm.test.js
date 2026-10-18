import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmClient } from '../src/llm.js';
import { HttpError } from '../src/http.js';

const config = {
  llm: { mock: false, apiKey: 'test-key', baseUrl: 'https://llm.example/v1', model: 'test-model' },
  limits: { timeoutMs: 1000, maxRetries: 0 },
};
const ok = { choices: [{ message: { content: '{"verdict":"FALSE"}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
const schema = { type: 'object', properties: { verdict: { type: 'string' } } };

test('llm: sends the JSON schema as response_format when given', async () => {
  const bodies = [];
  const chat = createLlmClient(config, { postJsonImpl: async (_url, { body }) => (bodies.push(body), ok) });
  const r = await chat([{ role: 'user', content: 'x' }], { jsonSchema: schema });
  assert.equal(r.content, '{"verdict":"FALSE"}');
  assert.deepEqual(r.usage, { input: 3, output: 2 });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].response_format.type, 'json_schema');
  assert.deepEqual(bodies[0].response_format.json_schema.schema, schema);
});

test('llm: max_tokens defaults to 2000, can be raised per call, and is capped at 8000', async () => {
  const bodies = [];
  const chat = createLlmClient(config, { postJsonImpl: async (_url, { body }) => (bodies.push(body), ok) });
  await chat([{ role: 'user', content: 'x' }]);
  await chat([{ role: 'user', content: 'x' }], { maxTokens: 4096 });
  await chat([{ role: 'user', content: 'x' }], { maxTokens: 999_999 });
  assert.deepEqual(bodies.map((b) => b.max_tokens), [2000, 4096, 8000]);
});

test('llm: no schema -> plain request without response_format', async () => {
  const bodies = [];
  const chat = createLlmClient(config, { postJsonImpl: async (_url, { body }) => (bodies.push(body), ok) });
  await chat([{ role: 'user', content: 'x' }]);
  assert.equal(bodies[0].response_format, undefined);
});

test('llm: provider rejects structured output (400) -> retries plain, then stops sending it', async () => {
  const bodies = [];
  const chat = createLlmClient(config, {
    postJsonImpl: async (_url, { body }) => {
      bodies.push(body);
      if (body.response_format) throw new HttpError('upstream HTTP 400', 400);
      return ok;
    },
  });
  const r = await chat([{ role: 'user', content: 'x' }], { jsonSchema: schema });
  assert.equal(r.content, '{"verdict":"FALSE"}');
  await chat([{ role: 'user', content: 'y' }], { jsonSchema: schema });
  assert.deepEqual(bodies.map((b) => Boolean(b.response_format)), [true, false, false]);
});

test('llm: other upstream errors (timeout, 500) are still thrown', async () => {
  const chat = createLlmClient(config, {
    postJsonImpl: async () => {
      throw new HttpError('upstream timeout', 0);
    },
  });
  await assert.rejects(chat([{ role: 'user', content: 'x' }], { jsonSchema: schema }), /timeout/);
});

// ---------- primary (Nebius) -> fallback (NVIDIA) ----------
const twoProviders = {
  llm: { mock: false, apiKey: 'k1', baseUrl: 'https://primary.example/v1', model: 'm1', name: 'Nebius Token Factory' },
  llmFallback: { apiKey: 'k2', baseUrl: 'https://fallback.example/v1', model: 'm2', name: 'NVIDIA API' },
  limits: { timeoutMs: 1000, maxRetries: 2, llmTimeoutMs: 1000, llmMaxRetries: 1 },
};

test('llm fallback: primary works -> fallback is never called, provider = primary', async () => {
  const urls = [];
  const chat = createLlmClient(twoProviders, { postJsonImpl: async (url) => (urls.push(url), ok) });
  const r = await chat([{ role: 'user', content: 'x' }], { jsonSchema: schema });
  assert.equal(r.provider, 'Nebius Token Factory');
  assert.ok(urls.every((u) => u.startsWith('https://primary.example')));
});

for (const [name, err] of [
  ['timeout', new HttpError('upstream timeout', 0)],
  ['429 rate limit', new HttpError('upstream HTTP 429', 429)],
  ['500', new HttpError('upstream HTTP 500', 500)],
  ['network error', new TypeError('fetch failed')],
]) {
  test(`llm fallback: primary ${name} -> answer comes from the fallback`, async () => {
    const seen = [];
    const chat = createLlmClient(twoProviders, {
      postJsonImpl: async (url, opts) => {
        seen.push({ url, retries: opts.maxRetries, model: opts.body.model, auth: opts.headers.Authorization });
        if (url.startsWith('https://primary.example')) throw err;
        return ok;
      },
    });
    const r = await chat([{ role: 'user', content: 'x' }], { jsonSchema: schema });
    assert.equal(r.provider, 'NVIDIA API');
    assert.equal(seen[0].retries, 0, 'primary does not retry when a fallback exists');
    const fb = seen.find((s) => s.url.startsWith('https://fallback.example'));
    assert.equal(fb.model, 'm2');
    assert.equal(fb.auth, 'Bearer k2', 'fallback uses its own key');
  });
}

test('llm fallback: both providers fail -> the error is thrown (judge turns it into UNVERIFIABLE)', async () => {
  const chat = createLlmClient(twoProviders, {
    postJsonImpl: async () => {
      throw new HttpError('upstream HTTP 503', 503);
    },
  });
  await assert.rejects(chat([{ role: 'user', content: 'x' }]), /503/);
});

test('llm fallback: structured-output 400 on the primary is handled there, not failed over', async () => {
  const urls = [];
  const chat = createLlmClient(twoProviders, {
    postJsonImpl: async (url, { body }) => {
      urls.push(url);
      if (body.response_format) throw new HttpError('upstream HTTP 400', 400);
      return ok;
    },
  });
  const r = await chat([{ role: 'user', content: 'x' }], { jsonSchema: schema });
  assert.equal(r.provider, 'Nebius Token Factory');
  assert.ok(urls.every((u) => u.startsWith('https://primary.example')));
});

test('llm: mock mode returns null', () => {
  assert.equal(createLlmClient({ ...config, llm: { mock: true } }), null);
});
