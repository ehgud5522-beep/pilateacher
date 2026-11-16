/**
 * 서버 기록 읽기 전환 (설계 문서 1단계-5, 2026-11-16 대표 승인).
 *
 * 서버(lessonRecords)의 줄을 기기 기록(member.notes)과 같은 모양으로 바꿔 **화면에만** 더한다. 기기에는 쓰지 않는다.
 *  - 기기에 이미 있는 기록(같은 기기기록 id)은 기기 것이 이긴다 -- 아직 보내지 않은 고침이 있을 수 있다
 *  - 고친 기록은 새 줄이 옛 줄을 가리킨다(supersedes) -- 가리켜진 옛 줄은 빼고 마지막 판만
 *  - 이렇게 더한 기록은 serverOnly 표시가 붙는다. "고치기" 대상으로 잡히지 않는다(note-edit.js) --
 *    다른 강사의 기록을 내 기록으로 덮어쓰면 안 된다
 * 다른 기기 · 대타 강사 · 새 폰에서도 같은 기록이 보이게 하는 것이 목적이다.
 */

const text = (value) => String(value ?? "").trim();
const millis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * @param {Array<any>} records 서버 줄 (id 포함)
 * @param {{ deviceNoteIds?: Iterable<string> }} [options]
 * @returns {Array<any>} 기기 기록 모양, serverOnly: true
 */
export function notesFromServerRecords(records, { deviceNoteIds = [] } = {}) {
  const onDevice = new Set([...deviceNoteIds].map(text));
  const rows = (Array.isArray(records) ? records : []).filter((row) => row && text(row.id) && text(row.body));
  const superseded = new Set(rows.map((row) => text(row.supersedes)).filter(Boolean));
  const latest = new Map();
  for (const row of rows) {
    if (superseded.has(text(row.id))) continue;
    if (onDevice.has(text(row.deviceNoteId))) continue;
    const key = `${text(row.createdBy)}|${text(row.deviceNoteId)}`;
    const current = latest.get(key);
    if (!current || millis(row.createdAt) > millis(current.createdAt)) latest.set(key, row);
  }
  return [...latest.values()].map((row) => {
    const voice = text(row.kind) === "voice";
    return {
      id: `server:${text(row.id)}`,
      ...(text(row.lessonId) ? { sid: text(row.lessonId) } : {}),
      date: text(row.lessonDate),
      type: "개인레슨",
      body: text(row.body),
      serverOnly: true,
      authorId: text(row.createdBy),
      ...(voice ? { voiceSource: "server" } : {}),
      lessonRecord: voice && row.fields
        ? { stage: "confirmed_record", status: "confirmed", confirmationStatus: "confirmed", confirmedRecord: row.fields, confirmedAt: text(row.confirmedAt) }
        : { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed", confirmedAt: text(row.confirmedAt) },
    };
  }).sort((left, right) => text(right.date).localeCompare(text(left.date)));
}

/** 화면에 쓸 회원 = 기기 기록 + 서버에서 더한 기록. 기기 회원 객체는 바꾸지 않는다. */
export function mergeServerNotes(member, serverRecords) {
  if (!member || !Array.isArray(serverRecords) || !serverRecords.length) return member;
  const deviceNotes = Array.isArray(member.notes) ? member.notes : [];
  const extra = notesFromServerRecords(serverRecords, { deviceNoteIds: deviceNotes.map((note) => note?.id) });
  return extra.length ? { ...member, notes: [...deviceNotes, ...extra] } : member;
}
