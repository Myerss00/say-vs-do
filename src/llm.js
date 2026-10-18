// OpenAI-compatible chat client (Nebius Token Factory / NVIDIA API). Base URL and model come ONLY from .env.
import { postJson, HttpError } from './http.js';

// Returns null in mock mode so callers fall back to labeled mock data.
// chat(messages, { jsonSchema }) -> { content, usage, provider }.
// With config.llmFallback set, any failure of the primary provider (timeout, 429, 5xx, network)
// is retried once on the fallback provider.
export function createLlmClient(config, { postJsonImpl = postJson } = {}) {
  if (config.llm.mock) return null;
  const timeoutMs = config.limits.llmTimeoutMs ?? config.limits.timeoutMs;
  const retries = config.limits.llmMaxRetries ?? config.limits.maxRetries;
  const fallbackCfg = config.llmFallback ?? null;
  // With a fallback available, fail over quickly instead of retrying the primary.
  const primary = createProviderChat(config.llm, { timeoutMs, maxRetries: fallbackCfg ? 0 : retries, postJsonImpl });
  if (!fallbackCfg) return primary;
  const fallback = createProviderChat(fallbackCfg, { timeoutMs, maxRetries: retries, postJsonImpl });
  return async function chatWithFallback(messages, opts) {
    try {
      return await primary(messages, opts);
    } catch (err) {
      console.warn(`[llm] ${config.llm.name ?? 'primary'} failed (${err.status ?? err.name ?? 'error'}); using ${fallbackCfg.name ?? 'fallback'}`);
      return fallback(messages, opts);
    }
  };
}

// One OpenAI-compatible provider. Asks for schema-constrained JSON when a schema is given;
// if the provider rejects that option (HTTP 400/422), it retries without it and stops sending it.
function createProviderChat({ apiKey, baseUrl, model, name }, { timeoutMs, maxRetries, postJsonImpl }) {
  let structuredSupported = true;
  const send = (body) =>
    postJsonImpl(`${baseUrl}/chat/completions`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      timeoutMs,
      maxRetries,
    });
  return async function chat(messages, { jsonSchema, maxTokens = 2000 } = {}) {
    // Reasoning models spend tokens thinking before the answer: leave room for both.
    // Long inputs (whole articles) think longer, so callers can raise the bounded cap.
    const body = { model, messages, temperature: 0, max_tokens: Math.min(maxTokens, 8000) };
    let data;
    if (jsonSchema && structuredSupported) {
      try {
        data = await send({ ...body, response_format: { type: 'json_schema', json_schema: { name: 'reply', schema: jsonSchema } } });
      } catch (err) {
        if (!(err instanceof HttpError && (err.status === 400 || err.status === 422))) throw err;
        structuredSupported = false;
        console.warn('[llm] structured output not accepted by the provider; using plain JSON prompts');
      }
    }
    data ??= await send(body);
    return {
      content: data?.choices?.[0]?.message?.content ?? '',
      usage: {
        input: Number(data?.usage?.prompt_tokens) || 0,
        output: Number(data?.usage?.completion_tokens) || 0,
      },
      provider: name ?? null,
    };
  };
}

// Pulls the first JSON value out of a model reply (handles <think> blocks and ``` fences).
// Throws if there is no parseable JSON; callers turn that into UNVERIFIABLE.
export function parseLlmJson(text) {
  if (typeof text !== 'string') throw new Error('LLM reply is not text');
  let s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start === -1) throw new Error('no JSON in LLM reply');
  const open = s[start];
  const end = s.lastIndexOf(open === '[' ? ']' : '}');
  if (end <= start) throw new Error('unterminated JSON in LLM reply');
  return JSON.parse(s.slice(start, end + 1));
}
