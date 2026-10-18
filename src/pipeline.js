// The three pipeline steps: extractClaims -> searchEvidence -> judgeClaim.
// `llm` / `search` are injected; null means "mock mode" for that step.
import { postJson } from './http.js';
import { parseLlmJson } from './llm.js';
import { buildExtractMessages, buildJudgeMessages } from './prompts.js';
import { ClaimListSchema, SourceSchema, VerdictSchema } from './schemas.js';
import { mockExtract, mockJudge, mockSearch } from './mock.js';

const TAVILY_URL = 'https://api.tavily.com/search';
const NO_USAGE = { input: 0, output: 0 };

export function createSearchClient(config) {
  if (config.search.mock) return null;
  const { timeoutMs, maxRetries } = config.limits;
  return async function search(query) {
    const data = await postJson(TAVILY_URL, {
      headers: { Authorization: `Bearer ${config.search.apiKey}` },
      body: { query: query.slice(0, 400), max_results: 5, search_depth: 'basic' },
      timeoutMs,
      maxRetries,
    });
    return Array.isArray(data?.results) ? data.results : [];
  };
}

// (1) text -> [{claim, type, language}]
export async function extractClaims(text, { mode = 'news', lang, llm = null, maxClaims = 5 } = {}) {
  if (!llm) return { claims: mockExtract(text, { mode, lang }).slice(0, maxClaims), usage: NO_USAGE };
  const reply = await llm(buildExtractMessages(text));
  let claims = [];
  try {
    const raw = parseLlmJson(reply.content);
    const parsed = ClaimListSchema.safeParse(Array.isArray(raw) ? raw : raw?.claims);
    if (parsed.success) claims = parsed.data;
  } catch {
    // Invalid model output -> no claims; never pass unvalidated output on.
  }
  return { claims: claims.slice(0, maxClaims), usage: reply.usage };
}

// (2) claim -> up to 5 validated sources {title, url, content}
export async function searchEvidence(claim, { search = null } = {}) {
  const raw = search ? await search(claim) : mockSearch(claim);
  return raw
    .map((r) => SourceSchema.safeParse(r))
    .filter((p) => p.success)
    .map((p) => p.data)
    .slice(0, 5);
}

const FALLBACK_TEXT = {
  de: 'Keine gültige Bewertung möglich.',
  en: 'No valid verdict could be produced.',
  es: 'No se pudo obtener un veredicto válido.',
};

export function unverifiable(claim, reason) {
  return {
    verdict: 'UNVERIFIABLE',
    confidence: 0,
    explanation: reason || FALLBACK_TEXT[claim.language] || FALLBACK_TEXT.en,
    source_url: null,
  };
}

// (3) claim + sources -> {verdict, confidence, explanation, source_url}
export async function judgeClaim(claim, sources, { mode = 'news', llm = null } = {}) {
  if (!llm) return { result: mockJudge(claim, sources), usage: NO_USAGE };
  let reply;
  try {
    reply = await llm(buildJudgeMessages(claim.claim, sources, mode));
    const parsed = VerdictSchema.safeParse(parseLlmJson(reply.content));
    if (!parsed.success) return { result: unverifiable(claim), usage: reply.usage };
    const result = parsed.data;
    // The link shown to users must be one of the real search results, never a model invention.
    const allowed = new Set(sources.map((s) => s.url));
    result.source_url = allowed.has(result.source_url) ? result.source_url : null;
    return { result, usage: reply.usage, valid: true }; // valid = real model verdict, safe to cache
  } catch {
    return { result: unverifiable(claim), usage: reply?.usage ?? NO_USAGE };
  }
}

const CACHED_FIELDS = ['claim', 'type', 'language', 'verdict', 'confidence', 'explanation', 'source_url', 'sources'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

// Whole flow for one request.
// ctx = { llm, search, budget, audit, pricing, sessionId, maxClaims, cache? }
// The demo cache is only used when BOTH steps are live: mock mode never reads or writes it,
// so it can only ever show DEMO cards, and only real live verdicts are ever stored.
export async function checkText({ text, mode, lang }, ctx) {
  const { llm, search, budget, audit, pricing, sessionId, maxClaims = 5 } = ctx;
  const cache = llm && search ? ctx.cache ?? null : null;
  const llmCost = (u) => (u.input * pricing.llmInPer1M + u.output * pricing.llmOutPer1M) / 1e6;

  const started = performance.now();
  const ms = (since) => Math.round(performance.now() - since);

  // Same pasted text seen before -> answer without any network call (works offline).
  const textHit = cache?.getText(mode, text);
  if (textHit && Array.isArray(textHit.value.results)) {
    const results = textHit.value.results.map((r) => ({ ...r, cached: true, cached_at: textHit.cachedAt, latency_ms: 0 }));
    for (const r of results) {
      audit({ sessionId, mode, claim: r.claim, verdict: r.verdict, source_urls: r.sources.map((s) => s.url), tokens: NO_USAGE, mock: { llm: false, search: false }, cached: true });
    }
    return { results, sessionCostUsd: budget.spent(sessionId), timing: { extract_ms: 0, total_ms: ms(started) } };
  }

  const extracted = await extractClaims(text, { mode, lang, llm, maxClaims });
  budget.add(sessionId, llmCost(extracted.usage));
  const extractMs = ms(started);

  const results = await Promise.all(
    extracted.claims.map(async (claim) => {
      const claimStart = performance.now();
      if (!budget.canSpend(sessionId)) {
        return {
          ...claim,
          ...unverifiable(claim, 'Session budget reached / límite de gasto alcanzado.'),
          sources: [],
          latency_ms: ms(claimStart),
        };
      }
      const claimHit = cache?.getClaim(mode, claim.claim);
      if (claimHit) {
        const r = claimHit.value;
        audit({ sessionId, mode, claim: claim.claim, verdict: r.verdict, source_urls: r.sources.map((s) => s.url), tokens: NO_USAGE, mock: { llm: false, search: false }, cached: true });
        return { ...claim, ...r, cached: true, cached_at: claimHit.cachedAt, latency_ms: ms(claimStart) };
      }
      let sources = [];
      let searchOk = true;
      try {
        sources = await searchEvidence(claim.claim, { search });
        if (search) budget.add(sessionId, pricing.tavilyPerSearch);
      } catch {
        searchOk = false;
        sources = []; // search failure -> judge sees no evidence -> UNVERIFIABLE
      }
      const judged = await judgeClaim(claim, sources, { mode, llm });
      budget.add(sessionId, llmCost(judged.usage));
      audit({
        sessionId,
        mode,
        claim: claim.claim,
        verdict: judged.result.verdict,
        source_urls: sources.map((s) => s.url),
        tokens: judged.usage,
        mock: { llm: !llm, search: !search },
      });
      const result = {
        ...claim,
        ...judged.result,
        sources: sources.map(({ title, url }) => ({ title, url })),
      };
      // Cache only real verdicts backed by evidence, never fallbacks caused by failures.
      const cacheable = Boolean(cache && judged.valid && searchOk && sources.length > 0);
      if (cacheable) cache.setClaim(mode, claim.claim, pick(result, CACHED_FIELDS));
      return { ...result, cacheable, latency_ms: ms(claimStart) }; // latency = search + verdict
    }),
  );
  if (cache && results.length > 0 && results.every((r) => r.cacheable || r.cached)) {
    cache.setText(mode, text, { results: results.map((r) => pick(r, CACHED_FIELDS)) });
  }
  for (const r of results) delete r.cacheable;
  return {
    results,
    sessionCostUsd: budget.spent(sessionId),
    timing: { extract_ms: extractMs, total_ms: ms(started) },
  };
}
