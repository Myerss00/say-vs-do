// Demo cache: real verdicts saved to cache/claims.json so a repeated claim (or a repeated pasted
// text) comes back instantly, even if Nebius or Tavily are down during the demo.
// Only verdicts produced live are stored (the pipeline enforces that), never mock/demo data.
// Keys are SHA-256 hashes of mode + normalized text; values hold no keys or session ids.
import { readFileSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const VERSION = 1;

// Lowercase, Unicode-normalized, accents/punctuation/quotes stripped, whitespace collapsed.
// "«Germany produced 60 %!»" and "germany produced 60%" map to the same key.
export function normalizeText(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s*%/g, '%')
    .trim();
}

export function cacheKey(kind, mode, text) {
  return createHash('sha256').update(`${kind}|${mode}|${normalizeText(text)}`).digest('hex');
}

export function createCache({ file = path.resolve('cache', 'claims.json'), maxEntries = 500, ttlMs = 7 * 24 * 3600_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.version === VERSION && data.entries && typeof data.entries === 'object') {
      for (const [k, e] of Object.entries(data.entries)) {
        if (/^[0-9a-f]{64}$/.test(k) && typeof e?.t === 'string' && e.v && typeof e.v === 'object') entries.set(k, e);
      }
    }
  } catch {
    // No file yet or unreadable: start empty.
  }

  let writing = Promise.resolve();
  let dirty = false;
  function persist() {
    dirty = true;
    writing = writing.then(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify({ version: VERSION, entries: Object.fromEntries(entries) }), 'utf8');
        await rename(tmp, file); // atomic: a crash never leaves half a file
      } catch (err) {
        console.error('[cache] write failed:', err.code || err.message);
      }
    });
    return writing;
  }

  function get(kind, mode, text) {
    const k = cacheKey(kind, mode, text);
    const e = entries.get(k);
    if (!e) return null;
    const age = now() - Date.parse(e.t);
    if (!(age >= 0 && age <= ttlMs)) {
      entries.delete(k);
      return null;
    }
    return { value: structuredClone(e.v), cachedAt: e.t };
  }

  function set(kind, mode, text, value) {
    const k = cacheKey(kind, mode, text);
    entries.delete(k); // re-insert so Map order = recency
    entries.set(k, { t: new Date(now()).toISOString(), v: structuredClone(value) });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return persist();
  }

  return {
    getClaim: (mode, claim) => get('c', mode, claim),
    setClaim: (mode, claim, value) => set('c', mode, claim, value),
    getText: (mode, text) => get('t', mode, text),
    setText: (mode, text, value) => set('t', mode, text, value),
    size: () => entries.size,
    flush: () => writing,
  };
}
