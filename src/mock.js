// Clearly labeled fake data so the app runs end to end without API keys.
// Every mock output says "MOCK" so it can never be mistaken for a real verdict.

const GREEN_WORDS = /(green|grün|verde|klima|climate|clima|co2|neutral|sustainab|nachhaltig|sostenib|eco|renewable|erneuerbar|renovable)/i;
const CHECKABLE = /\d|percent|prozent|por ciento|million|millionen|millones|billion|milliarden|always|never|immer|nie|siempre|nunca/i;

const LANG_HINTS = {
  de: /\b(der|die|das|und|ist|wir|nicht|haben)\b/i,
  es: /\b(el|la|los|las|y|es|que|hemos|somos)\b/i,
  en: /\b(the|and|is|we|have|are|our)\b/i,
};

export function guessLanguage(text, lang) {
  if (lang) return lang.slice(0, 2);
  for (const [code, re] of Object.entries(LANG_HINTS)) if (re.test(text)) return code;
  return 'und';
}

export function mockExtract(text, { mode = 'news', lang } = {}) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
  const picked = sentences.filter((s) => CHECKABLE.test(s) || GREEN_WORDS.test(s));
  const chosen = (picked.length ? picked : sentences.slice(0, 1)).slice(0, 5);
  return chosen.map((claim) => ({
    claim: claim.slice(0, 500),
    type: mode === 'corporate' ? (GREEN_WORDS.test(claim) ? 'green' : 'corporate') : 'news',
    language: guessLanguage(claim, lang),
  }));
}

export function mockSearch(claim) {
  return [
    {
      title: 'MOCK source 1 (no TAVILY_API_KEY set)',
      url: 'https://example.org/mock-source-1',
      content: `Placeholder evidence for: ${claim.slice(0, 120)}`,
    },
    {
      title: 'MOCK source 2 (no TAVILY_API_KEY set)',
      url: 'https://example.org/mock-source-2',
      content: 'Placeholder evidence. Real results appear once the Tavily key is in .env.',
    },
  ];
}

const MOCK_TEXT = {
  de: 'MOCK: Beispielurteil ohne echtes Modell (kein Nebius-Schlüssel).',
  en: 'MOCK: example verdict without a real model (no Nebius key).',
  es: 'MOCK: veredicto de ejemplo sin modelo real (sin clave de Nebius).',
};
const VERDICT_CYCLE = ['SUPPORTED', 'MISLEADING', 'FALSE', 'UNVERIFIABLE'];

// Deterministic: the same claim always gets the same fake verdict (stable demos/tests).
export function mockJudge(claim, sources) {
  let h = 0;
  for (const ch of claim.claim) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    verdict: VERDICT_CYCLE[h % VERDICT_CYCLE.length],
    confidence: 0.5,
    explanation: MOCK_TEXT[claim.language] || MOCK_TEXT.en,
    source_url: sources[0]?.url ?? null,
  };
}
