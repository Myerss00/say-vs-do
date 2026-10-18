// Say vs. Do frontend. No framework; all text is inserted with textContent (no innerHTML).
import { SCORE_KEYS, emptyScore, addResults, scoreShares } from './score.js';

const $ = (id) => document.getElementById(id);
const els = {
  transcript: $('transcript'),
  charCount: $('charCount'),
  checkBtn: $('checkBtn'),
  liveBtn: $('liveBtn'),
  langSelect: $('langSelect'),
  liveState: $('liveState'),
  interim: $('interim'),
  status: $('status'),
  results: $('results'),
  mockBadge: $('mockBadge'),
  cost: $('cost'),
};

const VERDICT_UI = {
  SUPPORTED: { icon: '✓', label: 'Respaldada', cls: 'v-supported' },
  MISLEADING: { icon: '!', label: 'Engañosa', cls: 'v-misleading' },
  FALSE: { icon: '✕', label: 'Falsa', cls: 'v-false' },
  UNVERIFIABLE: { icon: '?', label: 'No verificable', cls: 'v-unverifiable' },
};

// ---- light / dark theme (follows the OS until the user picks one) ----
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}
try {
  applyTheme(localStorage.getItem('svd-theme'));
} catch {
  /* storage blocked: follow the OS */
}
$('themeBtn').addEventListener('click', () => {
  const current =
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('svd-theme', next);
  } catch {
    /* ignore */
  }
});

let mode = 'news';
let mockState = { llm: false, search: false };

// ---- session id (random, per browser tab) ----
function getSessionId() {
  try {
    let id = sessionStorage.getItem('svd-session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('svd-session', id);
    }
    return id;
  } catch {
    return (getSessionId.fallback ??= crypto.randomUUID());
  }
}

// ---- helpers ----
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const setStatus = (msg, isError = false) => {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
};

// ---- status / MOCK badge ----
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    mockState = data.mock;
    showMockBadge();
  } catch {
    setStatus('No se pudo contactar con el servidor.', true);
  }
}
function showMockBadge() {
  const parts = [];
  if (mockState.llm) parts.push('LLM (sin clave Nebius)');
  if (mockState.search) parts.push('búsqueda (sin clave Tavily)');
  els.mockBadge.hidden = parts.length === 0;
  els.mockBadge.title = parts.length ? `Datos de prueba: ${parts.join(' + ')}` : '';
  els.mockBadge.textContent = parts.length === 2 ? 'MOCK' : `MOCK: ${parts.join(', ')}`;
}

// ---- API call ----
async function check(text) {
  const res = await fetch('/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() },
    body: JSON.stringify({ text, mode, lang: els.langSelect.value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.details) ? ` (${data.details.join('; ')})` : '';
    throw new Error((data.error || `Error ${res.status}`) + detail);
  }
  return data;
}

// ---- rendering ----
function renderCard(r, isMock) {
  const ui = r.demo ? { cls: 'v-demo' } : VERDICT_UI[r.verdict] || VERDICT_UI.UNVERIFIABLE;
  const card = el('article', `card ${ui.cls}`);

  const head = el('div', 'card-head');
  if (r.demo) {
    head.append(el('span', 'verdict', 'DEMO · sin veredicto real'));
  } else {
    const pill = el('span', 'verdict');
    pill.append(el('span', 'verdict-icon', ui.icon), r.verdict);
    head.append(pill, el('span', 'verdict-es', ui.label));
  }
  const meta = el('div', 'meta');
  if (isMock) meta.append(el('span', 'pill pill-mock', 'MOCK'));
  meta.append(el('span', 'chip', r.type));
  if (typeof r.confidence === 'number') meta.append(el('span', 'chip', `${Math.round(r.confidence * 100)} %`));
  if (Number.isFinite(r.latency_ms)) {
    const chip = el('span', 'chip', `${formatMs(r.latency_ms)}`);
    chip.title = 'Tiempo de búsqueda + veredicto de esta afirmación';
    meta.append(chip);
  }
  head.append(meta);
  card.append(head);

  card.append(el('p', 'claim', `«${r.claim}»`));
  card.append(el('p', 'explanation', r.explanation));

  if (isHttpUrl(r.source_url)) {
    const src = r.sources?.find((s) => s.url === r.source_url);
    const a = el('a', 'source', `↗ ${src?.title || new URL(r.source_url).hostname}`);
    a.href = r.source_url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    card.append(a);
  } else {
    card.append(el('p', 'source muted', 'Sin fuente suficiente'));
  }
  return card;
}

// ---- "Dice vs. Hace" score panel (counts verdicts of this tab's session) ----
let score = emptyScore();
function renderScore(prev) {
  const shares = scoreShares(score);
  for (const k of SCORE_KEYS) {
    const num = document.querySelector(`[data-score="${k}"]`);
    num.textContent = String(score[k]);
    if (prev && prev[k] !== score[k]) {
      num.classList.remove('bump');
      void num.offsetWidth; // restart the animation
      num.classList.add('bump');
    }
    // Exact ratio (not the rounded share) so the segments always fill the bar.
    document.querySelector(`[data-bar="${k}"]`).style.width = score.total ? `${(score[k] / score.total) * 100}%` : '0';
    document.querySelector(`[data-bar="${k}"]`).title = `${shares[k]} %`;
  }
  $('scoreTotal').textContent = `${score.total} ${score.total === 1 ? 'afirmación' : 'afirmaciones'} en esta sesión`;
  const demo = $('scoreDemo');
  demo.hidden = score.demo === 0;
  demo.textContent = `${score.demo} en modo DEMO (sin veredicto real, no cuentan).`;
}

const formatMs = (ms) => `${Math.round(ms).toLocaleString('es-ES')} ms`;

// Placeholder shown while a text waits in the queue / is being checked, with a live timer.
function createPendingCard(text) {
  const card = el('article', 'card card-pending');
  const head = el('div', 'card-head');
  const state = el('span', 'verdict', 'En cola');
  const timer = el('span', 'chip', '');
  const meta = el('div', 'meta');
  meta.append(timer);
  head.append(state, meta);
  card.append(head, el('p', 'claim', `«${text.length > 160 ? text.slice(0, 160) + '…' : text}»`));
  els.results.prepend(card);
  let t0 = 0;
  let tick = null;
  return {
    start() {
      t0 = performance.now();
      state.textContent = 'Comprobando…';
      card.classList.add('running');
      tick = setInterval(() => (timer.textContent = formatMs(performance.now() - t0)), 100);
    },
    finish() {
      clearInterval(tick);
      return t0 ? performance.now() - t0 : 0;
    },
    replaceWith(nodes) {
      card.replaceWith(...nodes);
    },
  };
}

function renderResults(data, pending, clientMs) {
  const prev = score;
  score = addResults(score, data.results);
  renderScore(prev);
  const isMock = data.mock?.llm || data.mock?.search;
  const n = data.results.length;
  setStatus(
    n
      ? `${n} ${n === 1 ? 'afirmación comprobada' : 'afirmaciones comprobadas'} en ${formatMs(clientMs)}` +
          (data.timing ? ` (extracción ${formatMs(data.timing.extract_ms)})` : '')
      : 'No se detectaron afirmaciones comprobables en ese texto.',
  );
  // The pending card turns into the result cards, in the same place (newest first).
  pending.replaceWith(data.results.map((r) => renderCard(r, isMock)));
  if (n) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof data.session_cost_usd === 'number') {
    els.cost.textContent = `Coste de la sesión: $${data.session_cost_usd.toFixed(4)} / $${data.max_session_cost_usd}`;
  }
}

// Serial queue so live sentences don't flood the API (rate limit is 20/min).
let queue = Promise.resolve();
function enqueueCheck(text) {
  const pending = createPendingCard(text);
  queue = queue.then(async () => {
    pending.start();
    try {
      const data = await check(text);
      renderResults(data, pending, pending.finish());
    } catch (err) {
      pending.finish();
      pending.replaceWith([]);
      setStatus(err.message, true);
    }
  });
  return queue;
}

// ---- paste + check ----
els.transcript.addEventListener('input', () => {
  els.charCount.textContent = `${els.transcript.value.length} / 5000`;
});
els.checkBtn.addEventListener('click', async () => {
  const text = els.transcript.value.trim();
  if (text.length < 3) return setStatus('Escribe o pega algo de texto primero.', true);
  els.checkBtn.disabled = true;
  await enqueueCheck(text);
  els.checkBtn.disabled = false;
});

// ---- mode toggle ----
document.querySelectorAll('.toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('.toggle-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    document.body.classList.toggle('mode-corporate', mode === 'corporate');
  });
});

// ---- live microphone (Chrome Web Speech API) ----
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;

function setLive(on) {
  listening = on;
  els.liveBtn.classList.toggle('on', on);
  els.liveBtn.setAttribute('aria-pressed', String(on));
  els.liveBtn.querySelector('.mic-label').textContent = on ? 'Detener' : 'En directo';
  els.liveState.textContent = on ? `Escuchando (${els.langSelect.value})…` : 'Micrófono apagado';
  els.langSelect.disabled = on;
  if (!on) els.interim.textContent = '';
}

if (!Recognition) {
  els.liveBtn.disabled = true;
  els.liveState.textContent = 'El modo en directo necesita Google Chrome.';
} else {
  els.liveBtn.addEventListener('click', () => {
    if (listening) {
      setLive(false);
      recognizer?.stop();
      return;
    }
    recognizer = new Recognition();
    recognizer.lang = els.langSelect.value;
    recognizer.continuous = true;
    recognizer.interimResults = true;

    recognizer.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0].transcript.trim();
        if (res.isFinal) {
          if (text.length >= 15) enqueueCheck(text.slice(0, 5000));
        } else {
          interim += text + ' ';
        }
      }
      els.interim.textContent = interim;
    };
    recognizer.onerror = (e) => {
      if (e.error === 'not-allowed') {
        setStatus('Permiso de micrófono denegado.', true);
        setLive(false);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setStatus(`Error del micrófono: ${e.error}`, true);
      }
    };
    // Chrome stops after silence; restart while the user still wants to listen.
    recognizer.onend = () => {
      if (listening) {
        try {
          recognizer.start();
        } catch {
          setLive(false);
        }
      }
    };
    try {
      recognizer.start();
      setLive(true);
    } catch (err) {
      setStatus(`No se pudo iniciar el micrófono: ${err.message}`, true);
    }
  });
}

loadStatus();
