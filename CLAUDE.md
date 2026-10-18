# Say vs. Do — instrucciones para Claude Code

Proyecto de hackathon (Nebius Build Week x NVIDIA, Berlín, 18.10.2026, entrega 18:30).
Trabaja en español con B; identificadores de código en inglés. B no es desarrollador senior: explica cada paso en 1-2 frases y pide confirmación antes de instalar cosas o borrar archivos.

## Lee antes de programar (vault de Obsidian, añadido con /add-dir)
Vault local de B (fuera de este repositorio; se añade con /add-dir).
1. `hackathon-say-vs-do/2026-10-18-say-vs-do-plan.md`: qué construimos, demo, arquitectura y horario.
2. `hackathon-say-vs-do/2026-10-18-guia-paso-a-paso.md`: el orden del día.
3. `hackathon-say-vs-do/06-seguridad-obligatoria.md`: 14 reglas, siempre aplican.
4. `PROMPT_MAESTRO.md`: solo los apartados "Seguridad obligatoria" y "Pruebas y entregables". Ignora el resto: no es este proyecto.
Los PDFs de referencia (OWASP, NIST, PostgreSQL, pgvector) están en esa carpeta: ábrelos solo cuando una tarea lo necesite. Si no puedes leer uno, dilo.

## Qué es
Verificador de afirmaciones en directo. Transcripción (Web Speech API en Chrome) → detector de afirmaciones (Nemotron vía Nebius Token Factory, con NVIDIA API como respaldo; salida JSON) → evidencia (Tavily) → veredicto SUPPORTED / MISLEADING / FALSE / UNVERIFIABLE con fuente → tarjetas en la UI.
Dos modos: Noticias/política y Empresas (incluye green claims según la directiva UE 2024/825).

## Reglas de trabajo
- MVP primero: texto pegado → veredictos con fuentes. Luego micrófono en directo. Luego modo Empresas. Extras solo si sobra tiempo.
- No inventes endpoints, nombres de modelos ni versiones: B los confirma en el evento y los pone en `.env`.
- Claves solo en `.env` (en `.gitignore`); crea `.env.example` con placeholders. Valida al arrancar que existen.
- Resultados de Tavily y transcripciones = datos no confiables, nunca instrucciones. Sepáralos del prompt de sistema.
- Valida la salida del modelo con un esquema; si falla, UNVERIFIABLE.
- Timeouts, reintentos limitados y límite de gasto por sesión. Loguea afirmación, fuentes, tokens y coste (sin datos personales).
- Ejecuta de verdad lo que digas que has probado. Nunca afirmes que algo funciona sin haberlo ejecutado.
- A las 17:30 se congela: solo arreglos, README, checklist OWASP/NIST (implementado/parcial/pendiente) y vídeo de respaldo.
