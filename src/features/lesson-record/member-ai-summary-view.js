/**
 * 회원 상세의 AI 요약 카드 (2026-11-17 대표 승인). 서버 회원 요약(memberSummaries, 설계 2단계)을 세 칸으로 --
 * 꼭 기억할 것 · 최근 흐름 · 계속 확인 중. 수업 관리 브리핑과 같은 칸 이름 · 같은 순서다.
 *
 * 같은 문장은 한 번만 (칸을 건너서도). 주의사항(강사가 적은 것)이 꼭 기억할 것 맨 앞에 선다.
 * 무엇으로 언제 만들었는지(기록 N건 · 날짜)는 늘 함께 보여 준다 -- 근거 없는 요약은 믿을 수 없다.
 */

const text = (value) => String(value ?? "").trim();
const keyOf = (value) => text(value).replace(/\s+/g, " ").toLowerCase();

export const AI_SUMMARY_STATE = Object.freeze({
  LOADING: "loading", // 아직 읽는 중
  EMPTY: "empty", // 요약이 아직 없다 (기록이 서버에 없거나 첫 요약 전)
  READY: "ready",
  STALE: "stale", // 최근 갱신이 실패해 이전 요약을 보여 준다
  ERROR: "error", // 읽지 못했다 -- 코드와 함께 말한다
});

const millisOf = (value) => {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return Date.parse(value);
};

const items = (summary, block) => (Array.isArray(summary?.[block]) ? summary[block] : [])
  .map((item) => ({ text: text(item?.text), sources: Array.isArray(item?.sources) ? item.sources.filter((source) => text(source?.date)) : [] }))
  .filter((item) => item.text);

/**
 * @param {{ row: any, loaded: boolean, focus?: string[] | string, readError?: string }} input
 *   row  서버 요약 문서 (없으면 null) · loaded 한 번이라도 읽었는가 · focus 강사가 적은 주의사항 · readError 읽기 실패 원본 코드
 */
export function memberAiSummaryView({ row, loaded, focus = [], readError = "" }) {
  const cautions = (Array.isArray(focus) ? focus : text(focus) ? [focus] : []).map(text).filter(Boolean);
  if (text(readError)) return { state: AI_SUMMARY_STATE.ERROR, blocks: [], meta: "", cautions, statusCode: text(readError) };
  const summary = row?.summary && typeof row.summary === "object" ? row.summary : null;
  if (!summary) {
    return { state: loaded ? AI_SUMMARY_STATE.EMPTY : AI_SUMMARY_STATE.LOADING, blocks: [], meta: "", cautions, statusCode: text(row?.statusCode) };
  }
  const seen = new Set();
  const once = (item) => { const key = keyOf(item.text); if (!key || seen.has(key)) return false; seen.add(key); return true; };
  const must = [...cautions.map((value) => ({ text: value, sources: [], origin: "caution" })), ...items(summary, "mustRemember")].filter(once);
  const blocks = [
    { key: "must-remember", title: "꼭 기억할 것", items: must },
    { key: "recent-trend", title: "최근 흐름", items: items(summary, "recentTrend").filter(once) },
    { key: "open-questions", title: "계속 확인 중", items: items(summary, "openQuestions").filter(once) },
  ].filter((block) => block.items.length);
  const count = Array.isArray(row.sourceRecordIds) ? row.sourceRecordIds.length : 0;
  const at = millisOf(row.generatedAt || row.updatedAt);
  const day = Number.isFinite(at) ? new Date(at + 9 * 3600e3).toISOString().slice(5, 10).replace("-", ".") : "";
  const meta = [count ? `강사 기록 ${count}건으로 만듦` : "강사 기록으로 만듦", day ? `${day} 업데이트` : ""].filter(Boolean).join(" · ");
  return {
    state: row.status === "failed" ? AI_SUMMARY_STATE.STALE : AI_SUMMARY_STATE.READY,
    blocks, meta, cautions, statusCode: text(row.statusCode),
  };
}
