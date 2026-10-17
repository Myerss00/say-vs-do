// Outbound HTTP with timeout + limited retries with exponential backoff.
// Only the two allowlisted hosts (Nebius base URL from .env, Tavily) are ever called.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const isRetryable = (status) => status === 429 || status >= 500;

export async function postJson(url, { headers = {}, body, timeoutMs = 15_000, maxRetries = 2, fetchImpl = fetch } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1000ms
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();
      // Do not include the response body: it can echo request data.
      lastErr = new HttpError(`upstream HTTP ${res.status}`, res.status);
      if (!isRetryable(res.status)) throw lastErr;
    } catch (err) {
      if (err instanceof HttpError && !isRetryable(err.status)) throw err;
      lastErr = err.name === 'TimeoutError' ? new HttpError('upstream timeout', 0) : err;
    }
  }
  throw lastErr;
}
