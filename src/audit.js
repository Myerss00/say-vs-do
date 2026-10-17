// Append-only audit log (JSON lines) in logs/. No keys, no raw session ids, PII masked.
import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+\d[\d\s().-]{7,}\d/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g;

export function maskPii(text) {
  return String(text).replace(EMAIL, '[email]').replace(IBAN, '[iban]').replace(PHONE, '[phone]');
}

const hashSession = (id) => createHash('sha256').update(String(id)).digest('hex').slice(0, 12);

export function createAuditLog(dir = path.resolve('logs')) {
  let ready = mkdir(dir, { recursive: true });
  return function audit(entry) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session: hashSession(entry.sessionId),
      mode: entry.mode,
      claim: maskPii(entry.claim),
      verdict: entry.verdict,
      source_urls: entry.source_urls,
      tokens: entry.tokens,
      mock: entry.mock,
    });
    const file = path.join(dir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
    ready = ready
      .then(() => appendFile(file, line + '\n', 'utf8'))
      .catch((err) => console.error('[audit] write failed:', err.code || err.message));
  };
}
