const MEMORY_USAGE_STORAGE_KEY = "pilateacher_member_memory_usage_v1";

const empty = () => ({ briefingRendered: 0, briefingOpened: 0, memoryCandidateCount: 0, memoryMergedCount: 0, patternCount: 0, updatedAt: null });

export function readMemberMemoryUsage(storage = globalThis.localStorage) {
  try { return { ...empty(), ...(JSON.parse(storage?.getItem(MEMORY_USAGE_STORAGE_KEY) || "null") || {}) }; }
  catch (_error) { return empty(); }
}

export function trackMemberMemoryUsage(event, details = {}, storage = globalThis.localStorage) {
  const usage = readMemberMemoryUsage(storage);
  const count = Math.max(0, Number(details.count) || 0);
  if (event === "briefing_rendered") usage.briefingRendered += Math.max(1, count);
  if (event === "briefing_opened") usage.briefingOpened += Math.max(1, count);
  if (event === "memory_candidates") usage.memoryCandidateCount += count;
  if (event === "memory_merged") usage.memoryMergedCount += count;
  if (event === "patterns") usage.patternCount += count;
  usage.updatedAt = new Date().toISOString();
  try { storage?.setItem(MEMORY_USAGE_STORAGE_KEY, JSON.stringify(usage)); } catch (_error) {}
  return usage;
}

export { MEMORY_USAGE_STORAGE_KEY };
