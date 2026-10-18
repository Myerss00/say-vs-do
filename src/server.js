// Express app. API keys never leave the server; the browser only talks to /api/*.
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CheckRequestSchema, SessionIdSchema, MAX_TEXT_LENGTH } from './schemas.js';
import { checkText } from './pipeline.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ config, llm, search, budget, audit, rateLimitPerMin = 20 }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'connect-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          // Local dev runs on http://localhost; enable this again behind HTTPS in production.
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitPerMin,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests, wait a minute.' },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(publicDir));

  const mock = { llm: !llm, search: !search };

  app.get('/api/status', (_req, res) => {
    res.json({ mock, maxTextLength: MAX_TEXT_LENGTH, maxSessionCostUsd: config.limits.maxSessionCostUsd });
  });

  app.post('/api/check', async (req, res) => {
    const sid = SessionIdSchema.safeParse(req.get('x-session-id'));
    if (!sid.success) return res.status(400).json({ error: 'Missing or invalid X-Session-Id header' });
    const input = CheckRequestSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: 'Invalid input', details: input.error.issues.map((i) => i.message) });
    }
    const sessionId = sid.data;
    if (!budget.canSpend(sessionId)) {
      return res.status(429).json({ error: 'Session budget reached / límite de gasto alcanzado' });
    }
    try {
      const out = await checkText(input.data, {
        llm,
        search,
        budget,
        audit,
        pricing: config.pricing,
        sessionId,
        maxClaims: config.limits.maxClaimsPerRequest,
      });
      res.json({
        mock,
        results: out.results,
        timing: out.timing,
        session_cost_usd: Number(out.sessionCostUsd.toFixed(4)),
        max_session_cost_usd: config.limits.maxSessionCostUsd,
      });
    } catch (err) {
      console.error('[check] upstream failure:', err.status ?? '', err.message);
      res.status(502).json({ error: 'Upstream service failed, try again.' });
    }
  });

  // Body-parser errors (bad JSON, too large) and anything else: no stack traces to the client.
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error('[server] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
