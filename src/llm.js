// OpenAI-compatible chat client for Nebius Token Factory. Base URL and model come ONLY from .env.
import { postJson } from './http.js';

// Returns null in mock mode so callers fall back to labeled mock data.
export function createLlmClient(config) {
  if (config.llm.mock) return null;
  const { apiKey, baseUrl, model } = config.llm;
  const { timeoutMs, maxRetries } = config.limits;
  return async function chat(messages) {
    const data = await postJson(`${baseUrl}/chat/completions`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { model, messages, temperature: 0, max_tokens: 800 },
      timeoutMs,
      maxRetries,
    });
    return {
      content: data?.choices?.[0]?.message?.content ?? '',
      usage: {
        input: Number(data?.usage?.prompt_tokens) || 0,
        output: Number(data?.usage?.completion_tokens) || 0,
      },
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
