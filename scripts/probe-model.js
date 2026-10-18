// Quick model probe: node scripts/probe-model.js <model> [<model>...]
// Sends one tiny judge-style prompt per model and prints status, latency, usage and the reply.
// Reads the key from .env; never prints it.
import 'dotenv/config';

const base = (process.env.NEBIUS_BASE_URL || '').replace(/\/+$/, '');
for (const model of process.argv.slice(2)) {
  const t = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: 'system', content: 'Reply only with JSON: {"verdict":"SUPPORTED|FALSE","confidence":0-1,"explanation":"short"}' },
        { role: 'user', content: 'Claim: Paris is the capital of France.' },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch((e) => ({ status: 'ERR ' + e.name, json: async () => ({}) }));
  const data = await res.json().catch(() => ({}));
  const msg = data.choices?.[0]?.message ?? {};
  console.log(`${model}  status=${res.status}  ${Date.now() - t}ms  usage=${JSON.stringify(data.usage ?? {})}`);
  console.log('  content:', JSON.stringify(String(msg.content ?? data.detail ?? data.error?.message ?? '').slice(0, 300)));
  if (msg.reasoning_content) console.log('  (has reasoning_content field)');
}
