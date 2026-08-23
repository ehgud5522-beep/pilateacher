const STORAGE_KEY = "pilateacher_ai_record_usage_v1";

const emptyUsage = () => ({ sttCount: 0, sttSeconds: 0, llmCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, successes: 0, failures: 0, completedRecords: 0, startedRecords: 0, updatedAt: null });

export function readLessonRecordUsage(storage = globalThis.localStorage) {
  try { return { ...emptyUsage(), ...(JSON.parse(storage?.getItem(STORAGE_KEY) || "null") || {}) }; }
  catch (_error) { return emptyUsage(); }
}

export function trackLessonRecordUsage(event, details = {}, storage = globalThis.localStorage) {
  const usage = readLessonRecordUsage(storage);
  if (event === "stt_complete") { usage.sttCount += 1; usage.sttSeconds += Math.max(0, Number(details.seconds) || 0); }
  if (event === "record_started") usage.startedRecords += 1;
  if (event === "llm_complete" || event === "llm_failed") {
    usage.llmCalls += Math.max(1, Number(details.attempts) || 1);
    usage.latencyMs += Math.max(0, Number(details.latencyMs) || 0);
    usage.inputTokens += Math.max(0, Number(details.usage?.inputTokens) || 0);
    usage.outputTokens += Math.max(0, Number(details.usage?.outputTokens) || 0);
    usage.totalTokens += Math.max(0, Number(details.usage?.totalTokens) || 0);
    if (event === "llm_complete") usage.successes += 1; else usage.failures += 1;
  }
  if (event === "record_confirmed") usage.completedRecords += 1;
  usage.updatedAt = new Date().toISOString();
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(usage)); } catch (_error) {}
  return usage;
}

export const LESSON_RECORD_USAGE_STORAGE_KEY = STORAGE_KEY;
