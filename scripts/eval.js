// Quality check with the REAL APIs: npm run eval
// Runs claims with a known answer (eval/claims.json) through search + judge and reports accuracy.
// Refuses to run without keys: mock verdicts are not real and would mean nothing.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { createLlmClient } from '../src/llm.js';
import { createSearchClient, searchEvidence, judgeClaim } from '../src/pipeline.js';

const config = loadConfig();
const llm = createLlmClient(config);
const search = createSearchClient(config);
if (!llm || !search) {
  console.log('Faltan claves: rellena .env (NEBIUS_API_KEY, NEBIUS_BASE_URL, NEMOTRON_MODEL, TAVILY_API_KEY)');
  process.exit(1);
}

const cases = JSON.parse(readFileSync(new URL('../eval/claims.json', import.meta.url), 'utf8'));
const rows = [];
for (const c of cases) {
  let sources = [];
  try {
    sources = await searchEvidence(c.claim, { search });
  } catch (err) {
    console.error(`search failed: ${err.message}`);
  }
  const { result } = await judgeClaim({ claim: c.claim, type: 'news', language: c.language }, sources, { mode: c.mode, llm });
  rows.push({ claim: c.claim.slice(0, 60), mode: c.mode, expected: c.expected, got: result.verdict, ok: result.verdict === c.expected ? '✔' : '✘' });
}

console.table(rows);
const hits = rows.filter((r) => r.ok === '✔').length;
console.log(`Accuracy: ${hits}/${rows.length} (${Math.round((hits / rows.length) * 100)} %)`);
