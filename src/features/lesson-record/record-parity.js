/**
 * 수업기록 서버 저장 · 비교 검증 (설계 문서 1단계-4, 2026-11-16 대표 승인).
 *
 * 강사 기기의 확정 기록(서버로 갈 것)과 서버에 실제로 있는 그 강사의 줄을 기록ID 로 맞춘다.
 *  - missing: 기기에는 있는데 서버에 없는 것 -> 보낼 줄에 다시 넣는다(스스로 메움)
 *  - extra: 서버에 있는데 지금 기기에 없는 것 -> 고친 기록의 옛 줄 · 다른 기기에서 쓴 줄. 오류가 아니다
 * 결과 숫자만 서버(lessonRecordParity/{강사})에 남겨 대표가 강사별로 본다. 기록 내용은 남기지 않는다.
 */

const text = (value) => String(value ?? "").trim();

/**
 * @param {{ deviceRecords: Array<{ recordId: string }>, serverRecords: Array<{ id: string, createdBy?: string }>, uid: string, queuedIds?: Iterable<string> }} input
 */
export function compareRecordSets({ deviceRecords = [], serverRecords = [], uid, queuedIds = [] }) {
  const mine = new Set((serverRecords || []).filter((row) => text(row?.createdBy) === text(uid)).map((row) => text(row?.id)));
  const device = new Set((deviceRecords || []).map((row) => text(row?.recordId)).filter(Boolean));
  const queued = new Set([...queuedIds].map(text));
  const missing = [...device].filter((id) => !mine.has(id));
  return {
    device: device.size,
    server: mine.size,
    missing: missing.length,
    missingNotQueued: missing.filter((id) => !queued.has(id)),
    waiting: missing.filter((id) => queued.has(id)).length,
    extra: [...mine].filter((id) => !device.has(id)).length,
  };
}

/** 대표 화면 한 줄. 차이가 보낼 줄에서 기다리는 것뿐이면 "보내는 중", 아니면 "확인 필요". */
export function parityState(row) {
  const missing = Number(row?.missing) || 0;
  const waiting = Number(row?.waiting) || 0;
  if (!missing) return { key: "ok", label: "일치" };
  if (missing === waiting) return { key: "sending", label: `보내는 중 ${waiting}건` };
  return { key: "check", label: `확인 필요 ${missing - waiting}건` };
}
