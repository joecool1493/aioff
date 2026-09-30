// Local-only stats. Daily counters keyed by site id and rule id. Never URLs, never content.

export interface DayStats {
  /** siteId -> ruleId -> count */
  [siteId: string]: { [ruleId: string]: number };
}

export interface StatsStore {
  /** "YYYY-MM-DD" -> DayStats */
  days: Record<string, DayStats>;
}

export const EMPTY_STATS: StatsStore = { days: {} };
const KEEP_DAYS = 90;

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addCounts(
  store: StatsStore,
  increments: { siteId: string; ruleId: string; n: number }[],
  now = new Date(),
): StatsStore {
  const key = dayKey(now);
  const days = { ...store.days };
  const day: DayStats = { ...(days[key] ?? {}) };
  for (const { siteId, ruleId, n } of increments) {
    // user rule ids embed a selector; keep only a generic bucket so nothing page-specific is stored
    const rid = ruleId.startsWith('user:') ? 'user-rule' : ruleId;
    day[siteId] = { ...(day[siteId] ?? {}) };
    day[siteId]![rid] = (day[siteId]![rid] ?? 0) + n;
  }
  days[key] = day;
  const keys = Object.keys(days).sort();
  while (keys.length > KEEP_DAYS) delete days[keys.shift()!];
  return { days };
}

export function totalSince(store: StatsStore, sinceDays: number, now = new Date()): number {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (sinceDays - 1));
  const cutoffKey = dayKey(cutoff);
  let total = 0;
  for (const [k, day] of Object.entries(store.days)) {
    if (k < cutoffKey) continue;
    for (const site of Object.values(day)) for (const n of Object.values(site)) total += n;
  }
  return total;
}

export function bySite(store: StatsStore, sinceDays: number, now = new Date()): { siteId: string; total: number }[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (sinceDays - 1));
  const cutoffKey = dayKey(cutoff);
  const totals = new Map<string, number>();
  for (const [k, day] of Object.entries(store.days)) {
    if (k < cutoffKey) continue;
    for (const [siteId, rules] of Object.entries(day)) {
      let t = totals.get(siteId) ?? 0;
      for (const n of Object.values(rules)) t += n;
      totals.set(siteId, t);
    }
  }
  return [...totals.entries()].map(([siteId, total]) => ({ siteId, total })).sort((a, b) => b.total - a.total);
}
