// Debug: run the real judge prompt once and show why the reply does or does not validate.
// node scripts/probe-judge.js   (reads .env, never prints keys)
import { loadConfig } from '../src/config.js';
import { buildJudgeMessages } from '../src/prompts.js';
import { parseLlmJson } from '../src/llm.js';
import { VerdictSchema } from '../src/schemas.js';
import { postJson } from '../src/http.js';
import { createSearchClient, searchEvidence } from '../src/pipeline.js';

const config = loadConfig();
// --claim "text": claim to judge (default: the Eiffel Tower example).
const ci = process.argv.indexOf('--claim');
const CLAIM = ci > -1 ? process.argv[ci + 1] : 'The Eiffel Tower is in Berlin.';
const JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['SUPPORTED', 'MISLEADING', 'FALSE', 'UNVERIFIABLE'] },
    confidence: { type: 'number' },
    explanation: { type: 'string' },
    source_url: { type: ['string', 'null'] },
  },
  required: ['verdict', 'confidence', 'explanation', 'source_url'],
};
// --real: use live Tavily results (5 sources, like the app does).
const sources = process.argv.includes('--real')
  ? await searchEvidence(CLAIM, { search: createSearchClient(config) })
  : [{ title: 'Eiffel Tower - Wikipedia', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', content: 'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France.' }];
console.log('sources:', sources.length);
const t = Date.now();
const data = await postJson(`${config.llm.baseUrl}/chat/completions`, {
  headers: { Authorization: `Bearer ${config.llm.apiKey}` },
  body: {
    model: config.llm.model,
    messages: buildJudgeMessages(CLAIM, sources, 'news'),
    temperature: 0,
    max_tokens: 2000,
    // --rf: ask for schema-constrained JSON output
    ...(process.argv.includes('--rf') ? { response_format: { type: 'json_schema', json_schema: { name: 'verdict', schema: JUDGE_JSON_SCHEMA } } } : {}),
  },
  timeoutMs: 60_000,
  maxRetries: 0,
});
const choice = data?.choices?.[0];
console.log(`${Date.now() - t}ms finish_reason=${choice?.finish_reason} usage=${JSON.stringify(data?.usage?.completion_tokens_details ?? {})} completion=${data?.usage?.completion_tokens}`);
console.log('content:', JSON.stringify(choice?.message?.content));
console.log('reasoning length:', String(choice?.message?.reasoning_content ?? '').length);
try {
  const parsed = VerdictSchema.safeParse(parseLlmJson(choice?.message?.content));
  console.log('valid:', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
} catch (e) {
  console.log('parse error:', e.message);
}
