# Say vs. Do

**Live fact-checking for what people say — speeches, interviews, ads and corporate "green" claims — with sources, in seconds.**

Built solo by **Brayan Anaya** at **Nebius × NVIDIA Build Week, Berlin (18 Oct 2026)**.

![Say vs. Do: live verdict cards with sources and the session score panel](docs/screenshot.png)

## The problem

Claims are made live — on stage, on TV, in a product ad — and checked days later, if ever. Meanwhile companies keep using vague "eco" and "climate-neutral" claims that the new **EU Directive 2024/825** (Empowering Consumers for the Green Transition) now treats as misleading.

## What it does

Paste a transcript or press **En directo** (live microphone). Say vs. Do:

1. finds the checkable claims in the text (numbers, dates, events, product and environmental claims),
2. searches the web for evidence,
3. gives each claim a verdict with a link to the source:

| Verdict | Meaning |
|---|---|
| ✓ **SUPPORTED** | the sources confirm it |
| ! **MISLEADING** | partly true, exaggerated or missing context |
| ✕ **FALSE** | the sources establish an incompatible fact |
| ? **UNVERIFIABLE** | not enough evidence — the app never guesses |

Two modes:

- **Noticias** (news / politics) — general fact-checking.
- **Empresas** (companies) — also applies the EU 2024/825 rules on green claims: generic "eco/green" claims without proof, climate neutrality through carbon offsets, whole-product claims that only apply to a part, future "net zero" promises without a verifiable plan, uncertified labels, legal requirements presented as features.

The UI shows a **"Dice vs. Hace" score panel** (verdict counts for the session), a **pending card with a live millisecond timer** for each text being checked, the **latency of each claim**, and a light/dark theme. Works in Spanish, German and English.

## How it works

```
mic (Web Speech API) or pasted text
        │
        ▼
 Nemotron: extract claims  ──▶  Tavily: search evidence (top 5)  ──▶  Nemotron: verdict + source
  (schema-constrained JSON)        (untrusted data, sanitized)          (schema-constrained JSON)
        │                                                                  │
        └──────────── zod validation of every model reply ────────────────┘
                                         │
                                         ▼
                 live verdict cards · score panel · demo cache · audit log
```

- **Model:** NVIDIA **Nemotron 3.5 Super** (`nvidia/nemotron-3.5-super-vl-120b-a12b`) through the OpenAI-compatible API at `build.nvidia.com` (`https://integrate.api.nvidia.com/v1`). The base URL and model come only from `.env`, so it also runs on **Nebius Token Factory** by changing `NEBIUS_BASE_URL` and `NEMOTRON_MODEL`.
- **Structured output:** requests use `response_format: json_schema`, so the reasoning model always returns valid JSON. If a provider does not support it, the client falls back to plain JSON prompts automatically.
- **Evidence:** [Tavily](https://tavily.com) search, 5 results per claim.
- **Server:** Node.js + Express. **Frontend:** plain HTML/CSS/JS, no framework, no CDN, system fonts.
- **Demo cache:** real verdicts are saved in `cache/claims.json` (keyed by a SHA-256 of mode + normalized text). A repeated text comes back instantly **without any network call**, so a live demo survives bad Wi-Fi. Only valid, evidence-backed verdicts are cached, and never in mock mode.

## Results

Evaluation with the real APIs on 12 claims with a known answer (DE / EN / ES, both modes; `npm run eval`):

**10 / 12 correct (83 %).** The two misses were cautious **UNVERIFIABLE** answers; no false claim was marked as true.

Example from the live app:

- "Alemania generó en 2025 el 60 % de su electricidad con renovables." → **MISLEADING** — sources report 58.6 % (Enerdata).
- "La Torre Eiffel está en Berlín." → **FALSE** — it is in Paris (Wikipedia).

Typical latency: 10–30 s for a new text (search + reasoning model), ~10 ms from the cache.

## Security

| Measure | Where |
|---|---|
| API keys only in `.env` (gitignored), never sent to the browser, never logged; startup prints only `true/false` per variable | `src/config.js`, `src/index.js` |
| All input validated with zod (text ≤ 5000 chars, unknown fields rejected), request body ≤ 32 KB | `src/schemas.js`, `src/server.js` |
| Every model reply validated with zod; invalid output → UNVERIFIABLE, never passed on | `src/pipeline.js` |
| Prompt-injection defence: transcripts and Tavily results are **untrusted data**, placed in separate user messages inside `<untrusted_data>` tags (tags inside the data are neutralized); the system prompt is constant | `src/prompts.js` |
| The source link can only be one of the real search-result URLs (http/https); the model cannot invent links | `src/pipeline.js`, `src/schemas.js` |
| Rate limit 20 requests/min per IP; timeouts (15 s search, 45 s reasoning model) with limited retries and exponential backoff | `src/server.js`, `src/http.js`, `src/config.js` |
| Spending cap per session and per server | `src/budget.js` |
| Audit log (`logs/`, gitignored): claim with PII masked (emails, phones, IBANs), source URLs, tokens, verdict, hashed session id — no keys | `src/audit.js` |
| helmet: CSP `default-src 'self'`, nosniff, no `x-powered-by`; errors without stack traces | `src/server.js` |
| Frontend never uses `innerHTML` (no XSS from model or source text) | `public/app.js` |
| Only two external hosts are called: the LLM base URL from `.env` and `api.tavily.com`. The model cannot run code or touch the file system | `src/llm.js`, `src/pipeline.js` |

Known limits (demo build): no user accounts and no HTTPS (runs on localhost); the spending cap lives in memory; price defaults are conservative estimates.

## Run it

Requirements: Node.js 20+ (tested on 24), Google Chrome for the live microphone.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# fill in .env (see below)
npm start                 # http://localhost:3000
npm test                  # 51 tests (node:test)
npm run eval              # accuracy on eval/claims.json with the real APIs
```

| `.env` variable | Purpose |
|---|---|
| `NEBIUS_API_KEY` | key for the OpenAI-compatible LLM API (NVIDIA build.nvidia.com or Nebius Token Factory) |
| `NEBIUS_BASE_URL` | e.g. `https://integrate.api.nvidia.com/v1` (the app calls `{URL}/chat/completions`) |
| `NEMOTRON_MODEL` | e.g. `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| `TAVILY_API_KEY` | Tavily search key |
| `MAX_SESSION_COST_USD` / `MAX_TOTAL_COST_USD` | spending caps (defaults 2 / 10) |
| `LLM_USD_PER_1M_INPUT_TOKENS`, `..._OUTPUT_TOKENS`, `TAVILY_USD_PER_SEARCH` | prices used for the caps (conservative defaults 1 / 3 / 0.01) |
| `DEMO_CACHE` | `off` disables the demo cache |

**No keys?** The app still runs end to end in **MOCK mode**: the UI shows a MOCK badge and grey "DEMO" cards, and it **never shows an invented verdict**.

Helper scripts: `scripts/warm-cache.js` (send the demo sentences once so they are cached), `scripts/probe-model.js` / `scripts/probe-judge.js` (debug the live model).

Privacy note: in Chrome, the Web Speech API sends audio to Google for transcription. Do not use real personal data in demos.

## API

- `GET /api/status` → `{ mock: { llm, search }, maxTextLength, maxSessionCostUsd }`
- `POST /api/check` with header `X-Session-Id` and body `{ "text": "...", "mode": "news" | "corporate", "lang": "de-DE" | "en-US" | "es-ES" }`
  → `{ mock, results: [{ claim, type, language, verdict, confidence, explanation, source_url, sources: [{ title, url }], latency_ms, cached?, cached_at? }], timing: { extract_ms, total_ms }, session_cost_usd, max_session_cost_usd }`

## License

MIT — see [LICENSE](LICENSE).
