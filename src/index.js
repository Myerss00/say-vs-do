// Entry point: npm start
import { loadConfig, envReport } from './config.js';
import { createLlmClient } from './llm.js';
import { createSearchClient } from './pipeline.js';
import { createBudget } from './budget.js';
import { createAuditLog } from './audit.js';
import { createApp } from './server.js';

const config = loadConfig();

console.log('Say vs. Do - environment check (set = true/false, values never printed):');
console.log(envReport());
console.log(`LLM step:    ${config.llm.mock ? 'MOCK (missing NEBIUS_* or NEMOTRON_MODEL)' : 'live (Nebius)'}`);
console.log(`Search step: ${config.search.mock ? 'MOCK (missing TAVILY_API_KEY)' : 'live (Tavily)'}`);

const app = createApp({
  config,
  llm: createLlmClient(config),
  search: createSearchClient(config),
  budget: createBudget(config.limits),
  audit: createAuditLog(),
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Listening on http://localhost:${config.port}`);
});
