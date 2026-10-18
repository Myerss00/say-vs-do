// Entry point: npm start
import { loadConfig, envReport } from './config.js';
import { createLlmClient } from './llm.js';
import { createSearchClient } from './pipeline.js';
import { createBudget } from './budget.js';
import { createAuditLog } from './audit.js';
import { createApp } from './server.js';
import { createCache } from './cache.js';

const config = loadConfig();

console.log('Say vs. Do - environment check (set = true/false, values never printed):');
console.log(envReport());
console.log(`LLM step:    ${config.llm.mock ? 'MOCK (missing NEBIUS_* or NEMOTRON_MODEL)' : 'live (Nebius)'}`);
console.log(`Search step: ${config.search.mock ? 'MOCK (missing TAVILY_API_KEY)' : 'live (Tavily)'}`);

const cache = config.cache.enabled ? createCache() : null;
console.log(
  `Demo cache:  ${cache ? `on (${cache.size()} entries, used only when both steps are live)` : 'off (DEMO_CACHE=off)'}`,
);

const app = createApp({
  config,
  llm: createLlmClient(config),
  search: createSearchClient(config),
  budget: createBudget(config.limits),
  audit: createAuditLog(),
  cache,
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Listening on http://localhost:${config.port}`);
});
