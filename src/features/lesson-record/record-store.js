/**
 * 수업기록 저장을 한 곳으로 (설계 문서 1단계-1 "저장 계층 분리", 2026-11-16 대표 승인).
 *
 * 지금 확정 기록은 두 곳에서 기기에 저장된다 -- saveScheduleComment(일정 시트 · 확인할 수업 · 회원 상세)와
 * saveNote("기록" 화면). 둘 다 기기 저장이 성공한 뒤 이 모듈의 afterDeviceSave 를 부른다. 이 단계에서는
 * **아무것도 하지 않는다**(isEnabled 가 늘 false) -- 다음 단계(1-2)가 여기에 서버 "보낼 줄" 을 붙인다.
 *
 * 순수 함수: 기기 기록 → 서버 기록 모양, 내용 지문, 기록ID. 서버 기록은 덮어쓰지 않는 한 줄이라
 * 같은 내용을 여러 번 보내도 한 줄만 생기도록 ID 를 내용 지문으로 정한다.
 *
 * 넣지 않는 것: 회원 이름 · 연락처, 녹음 전사 원문 · 음성 파일, 사진. 상담 메모(type "상담")는 보내지 않는다
 * -- 가격 · 개인 사정이 섞일 수 있다 (설계 문서 결정 1).
 */

import { LESSON_RECORD_FIELDS } from "./record-schema.js";
import { isVoiceRecordNote } from "./note-edit.js";

const text = (value) => String(value ?? "").trim();

export const SERVER_RECORD_KIND = Object.freeze({
  VOICE: "voice",
  MANUAL: "manual",
  NO_COMMENT: "no_comment",
});

/** 강사가 확정한 수업 기록인가. 확인 대기(자동저장 초안) · 상담 메모 · 빈 기록은 아니다. */
export function isServerEligibleNote(note) {
  if (!note || typeof note !== "object" || !text(note.id)) return false;
  if (text(note.type) === "상담" || text(note.type) === "인바디") return false;
  if (!text(note.body)) return false;
  const record = note.lessonRecord;
  if (!record || typeof record !== "object") return true; // 직접 입력 · 노코멘트는 저장이 곧 확정
  return text(record.confirmationStatus) === "confirmed" || text(record.stage) === "confirmed_record";
}

const itemsOf = (value) => (Array.isArray(value) ? value : [])
  .map((item) => (typeof item === "string" ? { text: text(item), origin: "ai" } : { text: text(item?.text), origin: text(item?.origin) || "ai" }))
  .filter((item) => item.text)
  .map((item) => ({ text: item.text.slice(0, 500), origin: ["ai", "instructor", "raw"].includes(item.origin) ? item.origin : "ai" }))
  .slice(0, 20);

/** 네 칸(+ 확인 필요). 확정본이 먼저, 없으면 강사가 고친 판. 구조가 없으면 null (직접 입력). */
function fieldsOf(note) {
  const record = note.lessonRecord && typeof note.lessonRecord === "object" ? note.lessonRecord : {};
  const source = [record.confirmedRecord, record.structuredDraft, note.aiSummaryTeacherEdited]
    .find((value) => value && typeof value === "object" && !Array.isArray(value) && LESSON_RECORD_FIELDS.some((field) => Array.isArray(value[field])));
  if (!source) return null;
  return Object.fromEntries(LESSON_RECORD_FIELDS.map((field) => [field, itemsOf(source[field])]));
}

/** FNV-1a 32bit -- 같은 내용이면 같은 값. 보안용이 아니라 "같은 줄인가" 를 가르는 용도. */
export function contentHash(value) {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 기록ID = 강사_기기기록_내용지문. 같은 저장을 여러 번 보내도 한 줄. Firestore 문서 ID 로 안전한 글자만. */
export const serverRecordId = (uid, noteId, hash) => `${text(uid)}_${text(noteId)}_${text(hash)}`
  .replace(/[^A-Za-z0-9_-]/g, "-")
  .slice(0, 300);

/**
 * 기기 기록 → 서버 기록. 보낼 것이 아니면 null.
 * @param {{ note: any, memberId: string, organizationId: string, uid: string, lesson?: any, appBuild?: string, source?: "app"|"migration", previousRecordId?: string }} input
 */
export function serverRecordFromNote({ note, memberId, organizationId, uid, lesson = null, appBuild = "", source = "app", previousRecordId = "" }) {
  if (!isServerEligibleNote(note) || !text(memberId) || !text(organizationId) || !text(uid)) return null;
  const body = text(note.body).slice(0, 4000);
  const fields = fieldsOf(note);
  const kind = isVoiceRecordNote(note) ? SERVER_RECORD_KIND.VOICE : body === "특이사항 없음" ? SERVER_RECORD_KIND.NO_COMMENT : SERVER_RECORD_KIND.MANUAL;
  const lessonId = text(note.sid);
  const lessonDate = text(lesson?.date) || text(note.date);
  const lessonStart = text(lesson?.start);
  const content = { lessonId, lessonDate, kind, body, fields };
  const hash = contentHash(content);
  return {
    recordId: serverRecordId(uid, note.id, hash),
    data: {
      organizationId: text(organizationId),
      clientId: text(memberId),
      lessonId,
      lessonDate,
      ...(lessonStart ? { lessonStart } : {}),
      instructorId: text(uid),
      createdBy: text(uid),
      kind,
      body,
      ...(fields ? { fields } : {}),
      deviceNoteId: text(note.id),
      contentHash: hash,
      ...(text(previousRecordId) && text(previousRecordId) !== serverRecordId(uid, note.id, hash) ? { supersedes: text(previousRecordId) } : {}),
      confirmedAt: text(note.confirmedAt) || text(note.lessonRecord?.confirmedAt) || "",
      source: source === "migration" ? "migration" : "app",
      appBuild: text(appBuild).slice(0, 40),
    },
  };
}

/**
 * 저장 후크. 기기 저장이 성공한 뒤 부른다. 이 단계(1-1)에서는 isEnabled 가 false 라 아무것도 하지 않는다.
 * 실패해도 기기 저장을 되돌리지 않는다 -- 던지지 않고 결과만 돌려준다.
 */
export function createRecordStore({ isEnabled = () => false, enqueue = () => {}, context = () => ({}) } = {}) {
  return {
    afterDeviceSave({ note, memberId, lesson = null }) {
      try {
        if (!isEnabled()) return { queued: false, reason: "disabled" };
        /* 기기 회원 id 는 센터 회원 id 와 다를 수 있다 -- 옛 회원은 연락처로 센터 회원에 이어져 있고 그 id 는
           orgClientId 에 있다. 서버 기록은 센터 회원 id 로만 쓴다(규칙 · 담당 판정). 이어지지 않은 회원은 보내지 않는다. */
        const { resolveClientId, ...rest } = context() || {};
        const clientId = typeof resolveClientId === "function" ? String(resolveClientId(memberId) || "") : String(memberId || "");
        if (!clientId) return { queued: false, reason: "not_centre_member" };
        const record = serverRecordFromNote({ note, memberId: clientId, lesson, ...rest });
        if (!record) return { queued: false, reason: "not_eligible" };
        enqueue(record);
        return { queued: true, recordId: record.recordId };
      } catch (error) {
        return { queued: false, reason: "error", code: text(error?.code || error?.name || "unknown") };
      }
    },
  };
}

/**
 * 기존 기록 이관 후보 (설계 문서 1단계-3, 결정 1: **확정 기록만**). 명부(members)에서 센터 회원에 이어진
 * 사람의 기록만 -- 서버에는 센터 회원 id(clientIdOf, 기본 orgClientId)로 쓴다. 기기에만 있는 회원은 서버
 * 규칙이 받지 않는다(회원 문서가 있어야 함). 이미 보낸 기록ID(doneIds)는 뺀다.
 * 기록ID 는 내용 지문이라 앱의 실시간 저장과 겹쳐도 서버에는 한 줄이다.
 *
 * @param {{ members: any[], clientIds: Set<string>|string[], schedule?: any[], organizationId: string, uid: string,
 *   appBuild?: string, doneIds?: Set<string>|string[], limit?: number }} input
 * @returns {{ records: Array<{ recordId: string, data: any }>, remaining: number, total: number }}
 */
export function migrationRecordsFor({ members = [], clientIdOf = (member) => member?.orgClientId, schedule = [], organizationId, uid, appBuild = "", doneIds = [], limit = 200 }) {
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds);
  const lessons = new Map((Array.isArray(schedule) ? schedule : []).filter((lesson) => lesson?.id).map((lesson) => [String(lesson.id), lesson]));
  const all = [];
  for (const member of Array.isArray(members) ? members : []) {
    const clientId = String(clientIdOf(member) || "").trim();
    if (!clientId) continue;
    for (const note of Array.isArray(member.notes) ? member.notes : []) {
      const record = serverRecordFromNote({
        note, memberId: clientId, organizationId, uid, appBuild, source: "migration",
        lesson: note?.sid ? lessons.get(String(note.sid)) || null : null,
      });
      if (record && !done.has(record.recordId)) all.push(record);
    }
  }
  return { records: all.slice(0, Math.max(0, limit)), remaining: Math.max(0, all.length - limit), total: all.length };
}
