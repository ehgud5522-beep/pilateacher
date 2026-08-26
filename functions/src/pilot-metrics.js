"use strict";

const FLAGS = Object.freeze(["no_speech", "low_confidence", "tail_dropped"]);

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function ratio(count, total) {
  return total ? Number((count / total * 100).toFixed(1)) : 0;
}

function summarizePilotMetrics(attempts = [], date = "") {
  const groups = new Map();
  attempts.filter((attempt) => !date || attempt?.date === date).forEach((attempt) => {
    const instructorId = String(attempt?.uid || attempt?.instructorId || "unknown");
    if (!groups.has(instructorId)) groups.set(instructorId, []);
    groups.get(instructorId).push(attempt);
  });
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([instructorId, items]) => {
    const successful = items.filter((item) => item.result === "ok");
    const confirmed = successful.filter((item) => item.confirmed === true).length;
    const flagCounts = Object.fromEntries(FLAGS.map((flag) => [flag, items.filter((item) => (item.flags || []).includes(flag)).length]));
    return {
      date: date || String(items[0]?.date || ""),
      instructorId,
      recordCount: successful.length,
      attemptCount: items.length,
      noSpeechRatio: ratio(flagCounts.no_speech, items.length),
      lowConfidenceRatio: ratio(flagCounts.low_confidence, items.length),
      tailDroppedRatio: ratio(flagCounts.tail_dropped, items.length),
      aiConfirmationRatio: ratio(confirmed, successful.length),
      medianCompletionToResultMs: median(successful.map((item) => item.latencyMs)),
    };
  });
}

function pilotMetricsMarkdown(rows = []) {
  const header = "| 날짜 | 강사 ID | 기록 수 | 시도 수 | no_speech | low_confidence | tail_dropped | AI 확인율 | 완료→결과 중앙값 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|";
  if (!rows.length) return `${header}\n| - | - | 0 | 0 | 0% | 0% | 0% | 0% | - |`;
  return `${header}\n${rows.map((row) => `| ${row.date} | ${row.instructorId} | ${row.recordCount} | ${row.attemptCount} | ${row.noSpeechRatio}% | ${row.lowConfidenceRatio}% | ${row.tailDroppedRatio}% | ${row.aiConfirmationRatio}% | ${row.medianCompletionToResultMs == null ? "-" : `${row.medianCompletionToResultMs}ms`} |`).join("\n")}`;
}

module.exports = { FLAGS, median, summarizePilotMetrics, pilotMetricsMarkdown };
