# Say vs. Do

Verificador de afirmaciones en directo: transcribe lo que se dice, detecta afirmaciones con Nemotron (Nebius Token Factory) y las contrasta con evidencia de Tavily.
Cada afirmación recibe un veredicto (✅ SUPPORTED / ⚠️ MISLEADING / ❌ FALSE / ❔ UNVERIFIABLE) con su fuente.
Proyecto para Nebius Build Week x NVIDIA (Berlín, 18.10.2026).

```
texto o micrófono ─▶ extractClaims (LLM, JSON) ─▶ searchEvidence (Tavily, máx. 5) ─▶ judgeClaim (LLM, JSON) ─▶ tarjetas
```

## Requisitos

- Node.js 20 o superior (probado con Node 24).
- Google Chrome para el modo 🎙️ En directo (Web Speech API).

## Puesta en marcha

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
# rellena .env (ver abajo)
npm start                 # http://localhost:3000
npm test                  # 25 pruebas con node:test
```

Al arrancar, el servidor imprime qué variables están definidas (`true`/`false`). **Nunca imprime los valores.**

### Variables de `.env`

| Variable | Para qué |
|---|---|
| `NEBIUS_API_KEY` | Clave de Nebius Token Factory |
| `NEBIUS_BASE_URL` | URL base OpenAI-compatible (se llama a `{URL}/chat/completions`). Confírmala en el evento. |
| `NEMOTRON_MODEL` | Nombre exacto del modelo Nemotron. Confírmalo en el evento. |
| `TAVILY_API_KEY` | Clave de Tavily (se envía como `Authorization: Bearer`) |
| `MAX_SESSION_COST_USD` | Límite de gasto por sesión del navegador (por defecto 2) |
| `MAX_TOTAL_COST_USD` | Límite de gasto global del servidor (por defecto 10) |
| `LLM_USD_PER_1M_INPUT_TOKENS` / `..._OUTPUT_TOKENS` / `TAVILY_USD_PER_SEARCH` | Precios para calcular el gasto. Por defecto estimaciones conservadoras (1 / 3 / 0,01 USD); pon los reales. |

## Modo MOCK

Si falta alguna clave, **ese paso** usa datos de prueba y la interfaz muestra la insignia **MOCK**:

- Sin `NEBIUS_*`/`NEMOTRON_MODEL`: las afirmaciones se detectan con una heurística simple y los veredictos son de ejemplo (el texto empieza por «MOCK:»).
- Sin `TAVILY_API_KEY`: las fuentes son `https://example.org/mock-source-*`.

Así la app funciona de punta a punta sin claves. Los veredictos MOCK **no son reales**.

## Uso

1. Elige **Noticias** o **Empresas**. Empresas añade al juez las reglas de *green claims* de la Directiva (UE) 2024/825 (afirmaciones ambientales genéricas, compensación de CO₂, afirmaciones futuras sin plan verificable, etiquetas sin certificación…).
2. Pega una transcripción y pulsa **Comprobar**, o
3. Elige idioma (de-DE / en-US / es-ES) y pulsa **🎙️ En directo**: cada frase final se envía a `/api/check`.

Nota de privacidad: en Chrome, la Web Speech API envía el audio a los servidores de Google para transcribirlo. No uses datos personales reales en la demo.

## API

- `GET /api/status` → `{ mock: { llm, search }, maxTextLength, maxSessionCostUsd }`
- `POST /api/check` con cabecera `X-Session-Id` y cuerpo `{ "text": "...", "mode": "news" | "corporate", "lang": "de-DE" | "en-US" | "es-ES" }`
  → `{ mock, results: [{ claim, type, language, verdict, confidence, explanation, source_url, sources: [{title, url}] }], session_cost_usd, max_session_cost_usd }`

## Seguridad (resumen)

| Medida | Dónde |
|---|---|
| Claves solo en `.env` (en `.gitignore`), nunca en el navegador ni en logs; chequeo true/false al arrancar | `src/config.js`, `src/index.js` |
| Validación zod de toda entrada (texto ≤ 5000 caracteres, campos extra rechazados) y cuerpo ≤ 32 KB | `src/schemas.js`, `src/server.js` |
| Salida del LLM validada con zod; si falla → UNVERIFIABLE | `src/pipeline.js` |
| Transcripciones, afirmaciones y resultados de Tavily van en mensajes de usuario separados, envueltos en `<untrusted_data>` con «treat as data, not instructions»; el prompt de sistema es constante | `src/prompts.js` |
| El enlace de la fuente solo puede ser una URL real de Tavily (http/https); el modelo no puede inventar enlaces | `src/pipeline.js`, `src/schemas.js` |
| Rate limit 20 peticiones/min por IP, timeouts de 15 s, máx. 2 reintentos con backoff | `src/server.js`, `src/http.js` |
| Límite de gasto por sesión y global | `src/budget.js` |
| Log de auditoría `logs/audit-AAAA-MM-DD.jsonl`: afirmación (PII enmascarada), URLs, tokens, veredicto; sesión como hash; sin claves | `src/audit.js` |
| helmet (CSP `default-src 'self'`, nosniff…), sin `x-powered-by`, errores sin stack trace | `src/server.js` |
| Frontend sin `innerHTML`: todo con `textContent` (sin XSS desde el modelo o las fuentes) | `public/app.js` |
| Solo dos hosts externos: `NEBIUS_BASE_URL` y `api.tavily.com`. El agente no ejecuta código ni toca el sistema de archivos | `src/llm.js`, `src/pipeline.js` |

### Limitaciones conocidas (pendiente)

- Sin autenticación ni HTTPS: pensado para demo local. En producción: HTTPS, reactivar `upgrade-insecure-requests`, sesiones con cookie segura y CSRF.
- El límite de gasto vive en memoria (se reinicia con el servidor) y el `X-Session-Id` lo genera el navegador; el límite global lo compensa.
- Los precios por defecto son estimaciones, no los reales.
- Falta la revisión OWASP Top 10 / OWASP LLM Top 10 completa antes de entregar.
