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

test('llm: mock mode returns null', () => {
  assert.equal(createLlmClient({ ...config, llm: { mock: true } }), null);
});
