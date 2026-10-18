// News links: if the user pastes ONLY a link, Tavily Extract reads the page for us.
// Our server never fetches arbitrary URLs itself (no SSRF): it only calls the allowlisted
// api.tavily.com. The article text is untrusted data and goes through the normal pipeline.
import { z } from 'zod';
import { postJson } from './http.js';

const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
export const MAX_ARTICLE_CHARS = 6000; // enough for the claims of a news article, bounded cost

export class ArticleError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Private, loopback and link-local hosts are refused even though Tavily (not us) would fetch them.
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

// zod schema for a news link: one public http(s) URL, bounded length, no credentials, no private hosts.
export const ArticleUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\/\S+$/i, 'single http(s) link')
  .url()
  .refine((s) => {
    // zod still runs this after earlier checks fail, so it must never throw.
    try {
      const u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && !PRIVATE_HOST.test(u.hostname);
    } catch {
      return false;
    }
  }, 'public http(s) link without credentials');

// True when the whole input is a single public http(s) link.
export function isArticleUrl(text) {
  return ArticleUrlSchema.safeParse(String(text)).success;
}

// Markdown from the extractor -> plain text: drops images, keeps link text, removes markup.
export function cleanArticleText(markdown) {
  return String(markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_>`|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, MAX_ARTICLE_CHARS);
}

// Returns readArticle(url) -> { url, title, text }, or null in mock mode (no Tavily key).
export function createArticleReader(config, { postJsonImpl = postJson } = {}) {
  if (config.search.mock) return null;
  const { timeoutMs, maxRetries } = config.limits;
  return async function readArticle(url) {
    let data;
    try {
      data = await postJsonImpl(TAVILY_EXTRACT_URL, {
        body: { api_key: config.search.apiKey, urls: [url], extract_depth: 'basic' },
        timeoutMs,
        maxRetries,
      });
    } catch {
      throw new ArticleError('No se pudo leer el enlace (el servicio de lectura falló). Pega el texto de la noticia.', 502);
    }
    const page = Array.isArray(data?.results) ? data.results[0] : null;
    const text = cleanArticleText(page?.raw_content);
    if (!page || text.length < 40) {
      throw new ArticleError('No se pudo leer el contenido de ese enlace. Pega el texto de la noticia.', 422);
    }
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const title = String(page.title ?? '').trim().slice(0, 300) || domain;
    return { url, title, domain, text: `${title}\n${text}` };
  };
}
