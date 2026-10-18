// Debug: read a news link with Tavily Extract and show what the claim extractor returns.
// node scripts/probe-article.js <url>   (reads .env, never prints keys)
import { loadConfig } from '../src/config.js';
import { createLlmClient } from '../src/llm.js';
import { createArticleReader } from '../src/article.js';
import { buildExtractMessages } from '../src/prompts.js';
import { EXTRACT_JSON_SCHEMA, ClaimListSchema } from '../src/schemas.js';
import { parseLlmJson } from '../src/llm.js';

const url = process.argv[2];
const config = loadConfig();
const page = await createArticleReader(config)(url);
console.log(`title: ${page.title}\nchars: ${page.text.length}\nstart: ${page.text.slice(0, 300).replace(/\n/g, ' | ')}\n`);
const llm = createLlmClient(config);
const t = Date.now();
const reply = await llm(buildExtractMessages(page.text), { jsonSchema: EXTRACT_JSON_SCHEMA, maxTokens: 4096 });
console.log(`${Date.now() - t}ms provider=${reply.provider} usage=${JSON.stringify(reply.usage)}`);
console.log('raw:', JSON.stringify(reply.content).slice(0, 1200));
try {
  const raw = parseLlmJson(reply.content);
  const parsed = ClaimListSchema.safeParse(Array.isArray(raw) ? raw : raw?.claims);
  console.log('valid:', parsed.success, parsed.success ? parsed.data.length + ' claims' : JSON.stringify(parsed.error.issues).slice(0, 500));
} catch (e) {
  console.log('parse error:', e.message);
}
