// Warm the demo cache: sends each demo sentence once through the running app (npm start).
// node scripts/warm-cache.js [baseUrl]   — sequential, so it stays under the model's rate limit.
// Edit DEMO below to change the sentences. Output: verdict + source per claim (no keys involved).
const base = process.argv[2] || 'http://127.0.0.1:3000';
const DEMO = [
  { mode: 'news', lang: 'es-ES', text: 'La Gran Muralla China se ve desde el espacio a simple vista.' },
  { mode: 'news', lang: 'es-ES', text: 'Berlín es la capital de Alemania desde la reunificación de 1990.' },
  { mode: 'news', lang: 'es-ES', text: 'La UE prohíbe todos los coches de gasolina a partir de 2035.' },
  { mode: 'corporate', lang: 'es-ES', text: 'Nuestros vuelos son 100 % climáticamente neutros gracias a la compensación de CO2.' },
  { mode: 'corporate', lang: 'es-ES', text: 'Nuestra botella es eco y respetuosa con el medio ambiente.' },
];

for (const item of DEMO) {
  const t = Date.now();
  const res = await fetch(`${base}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'warm-cache-script' },
    body: JSON.stringify(item),
  });
  const data = await res.json().catch(() => ({}));
  console.log(`\n[${item.mode}] ${item.text}  -> HTTP ${res.status}, ${Date.now() - t} ms`);
  for (const r of data.results ?? []) {
    console.log(`  ${r.verdict}${r.cached ? ' (cached)' : ''} ${Math.round((r.confidence ?? 0) * 100)}% | ${r.claim}`);
    console.log(`    ${r.explanation}`);
    console.log(`    source: ${r.source_url ?? '-'}`);
  }
  if (!res.ok) console.log('  error:', data.error);
}
