// In-memory spending cap: per session AND a global cap for the whole process
// (a client could rotate session ids, the global cap still stops runaway cost).
const MAX_SESSIONS = 5000;

export function createBudget({ maxSessionCostUsd, maxTotalCostUsd }) {
  const sessions = new Map();
  let total = 0;

  return {
    canSpend(sessionId) {
      return (sessions.get(sessionId) ?? 0) < maxSessionCostUsd && total < maxTotalCostUsd;
    },
    add(sessionId, usd) {
      if (!(usd > 0)) return;
      if (!sessions.has(sessionId) && sessions.size >= MAX_SESSIONS) {
        sessions.delete(sessions.keys().next().value); // evict oldest
      }
      sessions.set(sessionId, (sessions.get(sessionId) ?? 0) + usd);
      total += usd;
    },
    spent(sessionId) {
      return sessions.get(sessionId) ?? 0;
    },
    totalSpent() {
      return total;
    },
  };
}
