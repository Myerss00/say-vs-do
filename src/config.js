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
  'NVIDIA_API_KEY',
  'NVIDIA_BASE_URL',
  'NVIDIA_MODEL',
  'DEMO_CACHE',
  'PORT',
];

const cleanUrl = (name) => (process.env[name] || '').trim().replace(/\/+$/, '');

// Human-readable provider name shown on the cards (derived from the base URL, never the key).
export function providerName(baseUrl) {
  if (/nebius/i.test(baseUrl)) return 'Nebius Token Factory';
  if (/nvidia/i.test(baseUrl)) return 'NVIDIA API';
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'LLM';
  }
}

function provider(keyVar, urlVar, modelVar) {
  if (!(has(keyVar) && has(urlVar) && has(modelVar))) return null;
  const baseUrl = cleanUrl(urlVar);
  return { apiKey: process.env[keyVar], baseUrl, model: process.env[modelVar].trim(), name: providerName(baseUrl) };
}

export function loadConfig() {
  // Primary LLM (Nebius Token Factory) and optional fallback (NVIDIA API) used on error/timeout/429.
  const primary = provider('NEBIUS_API_KEY', 'NEBIUS_BASE_URL', 'NEMOTRON_MODEL');
  const fallback = provider('NVIDIA_API_KEY', 'NVIDIA_BASE_URL', 'NVIDIA_MODEL');
  const main = primary ?? fallback;
  const searchReady = has('TAVILY_API_KEY');
  return {
    port: num('PORT', 3000),
    // Demo cache of real verdicts in cache/claims.json. DEMO_CACHE=off disables it.
    cache: { enabled: (process.env.DEMO_CACHE || '').trim().toLowerCase() !== 'off' },
    llm: main ? { mock: false, ...main } : { mock: true },
    llmFallback: primary && fallback ? fallback : null,
    search: {
      mock: !searchReady,
      apiKey: process.env.TAVILY_API_KEY,
    },
    limits: {
      maxSessionCostUsd: num('MAX_SESSION_COST_USD', 2),
      maxTotalCostUsd: num('MAX_TOTAL_COST_USD', 10),
      timeoutMs: 15_000, // search
      maxRetries: 2,
      // Reasoning models can think for 20+ s on a hard claim: give them longer, retry once.
      llmTimeoutMs: 45_000,
      llmMaxRetries: 1,
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
