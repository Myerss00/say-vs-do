// Loads configuration from .env. Never print or log values, only whether they are set.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const has = (name) => typeof process.env[name] === 'string' && process.env[name].trim() !== '';

const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return has(name) && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const REQUIRED_VARS = ['NEBIUS_API_KEY', 'NEBIUS_BASE_URL', 'NEMOTRON_MODEL', 'TAVILY_API_KEY'];
export const OPTIONAL_VARS = [
  'MAX_SESSION_COST_USD',
  'MAX_TOTAL_COST_USD',
  'LLM_USD_PER_1M_INPUT_TOKENS',
  'LLM_USD_PER_1M_OUTPUT_TOKENS',
  'TAVILY_USD_PER_SEARCH',
  'DEMO_CACHE',
  'PORT',
];

export function loadConfig() {
  const llmReady = has('NEBIUS_API_KEY') && has('NEBIUS_BASE_URL') && has('NEMOTRON_MODEL');
  const searchReady = has('TAVILY_API_KEY');
  return {
    port: num('PORT', 3000),
    // Demo cache of real verdicts in cache/claims.json. DEMO_CACHE=off disables it.
    cache: { enabled: (process.env.DEMO_CACHE || '').trim().toLowerCase() !== 'off' },
    llm: {
      mock: !llmReady,
      apiKey: process.env.NEBIUS_API_KEY,
      baseUrl: (process.env.NEBIUS_BASE_URL || '').trim().replace(/\/+$/, ''),
      model: (process.env.NEMOTRON_MODEL || '').trim(),
    },
    search: {
      mock: !searchReady,
      apiKey: process.env.TAVILY_API_KEY,
    },
    limits: {
      maxSessionCostUsd: num('MAX_SESSION_COST_USD', 2),
      maxTotalCostUsd: num('MAX_TOTAL_COST_USD', 10),
      timeoutMs: 15_000,
      maxRetries: 2,
      maxClaimsPerRequest: 5,
    },
    // Conservative cost ESTIMATES for the spending cap. B replaces them with real prices.
    pricing: {
      llmInPer1M: num('LLM_USD_PER_1M_INPUT_TOKENS', 1),
      llmOutPer1M: num('LLM_USD_PER_1M_OUTPUT_TOKENS', 3),
      tavilyPerSearch: num('TAVILY_USD_PER_SEARCH', 0.01),
    },
  };
}

// Startup check: prints only true/false per variable, never the value.
export function envReport() {
  return [...REQUIRED_VARS, ...OPTIONAL_VARS].map((v) => `  ${v}: ${has(v)}`).join('\n');
}
