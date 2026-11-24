/**
 * 강사 기록 현황 (2026-11-21 대표: "강사들 회원관리 기록 남기는지 · 누가 안 하고 누가 잘하는지").
 *
 * ── 왜 둘로 나뉘는가 ──
 * 수업기록 원문은 강사 기기에만 있다. 서버로 올리는 스위치(lessonRecordServer)는 동의 문구 검토 때문에
 * 꺼져 있다 -- 그래서 대표 화면이 볼 수 있는 것은 두 가지뿐이다:
 *   1. 서버: 확정한 수업(원장 차감)과 회원에게 보낸 말(lessonNotes). 정확히 수업 · 회원 단위로 맞춘다.
 *   2. 기기 보고: 강사 폰이 "이 달 출석 처리한 수업 N건 중 기록 남긴 것 M건" **숫자만** 올린다
 *      (organizations/{센터}/recordActivity/{uid}_{YYYY-MM}). 기록 내용 · 회원 이름 · 회원 id 는 없다.
 *
 * 기기 보고는 **폰 앱에서만** 쓴다. 웹 브라우저의 기기 저장은 따로라 비어 있을 수 있고, 그 0 이 폰의
 * 숫자를 덮으면 잘하는 강사가 "안 함" 으로 보인다.
 *
 * 순수 함수다. 문구 · 색 · 정렬은 여기서만 정한다.
 */

import { isServerEligibleNote, SERVER_RECORD_KIND } from "../lesson-record/record-store.js";
import { isVoiceRecordNote } from "../lesson-record/note-edit.js";

const text = (value) => String(value ?? "").trim();
const MONTH = /^\d{4}-\d{2}$/;

export const RECORD_ACTIVITY_COLLECTION = "recordActivity";
/** 숫자 칸의 상한. 규칙도 같은 값을 본다. */
export const RECORD_ACTIVITY_MAX = 5000;
/** 이 비율 아래면 "부족" 으로 칠한다 (대표가 바꾸고 싶으면 여기 한 곳). */
export const RECORD_RATE_GOOD = 0.9;
export const RECORD_RATE_LOW = 0.6;

export const isRecordMonth = (month) => MONTH.test(text(month));
export const recordActivityId = (uid, month) => `${text(uid)}_${text(month)}`;

export function monthOf(date) {
  const at = date instanceof Date ? date : new Date(date);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

/** 지난달 "YYYY-MM". */
export function previousRecordMonth(month) {
  const [year, value] = text(month).split("-").map(Number);
  const at = new Date(year, value - 2, 1);
  return monthOf(at);
}

const attendeesOf = (lesson) => {
  if (!lesson || typeof lesson !== "object") return [];
  if (Array.isArray(lesson.attendees) && lesson.attendees.length) return lesson.attendees.filter((item) => item && item.memberId);
  return lesson.memberId ? [{ memberId: lesson.memberId, status: lesson.status || "booked" }] : [];
};

const lessonEnded = (lesson, now) => {
  const date = text(lesson?.date);
  const end = text(lesson?.end || lesson?.start || "23:59");
  const at = new Date(`${date}T${end}:00`).getTime();
  return Boolean(date) && !Number.isNaN(at) && at <= now.getTime();
};

const kindOf = (note) => {
  if (isVoiceRecordNote(note)) return SERVER_RECORD_KIND.VOICE;
  return text(note?.body) === "특이사항 없음" ? SERVER_RECORD_KIND.NO_COMMENT : SERVER_RECORD_KIND.MANUAL;
};

/**
 * 기기에서 센다: 이 달에 끝난 수업 중 **출석(done)으로 처리한 회원 한 명** 이 한 건이다 (듀엣은 2건).
 *  - recorded  확정한 기록이 있다 (직접 입력 · 특이사항 없음 · 확인을 마친 AI 기록)
 *  - draft     기록은 있는데 아직 확인하지 않았다 (AI 초안)
 * 둘은 겹치지 않는다. 기기는 이 둘을 따로 올리고, **기록률은 대표 화면이 둘을 더해서** 낸다 (instructorRecordBoard) --
 * AI 기록 확인은 선택이다(2026-11-24, #273). 확인을 건너뛴 음성 기록을 "빠짐" 으로 세면 음성을 쓰는 강사가 부족으로 보인다.
 * 기기 쪽 숫자를 그대로 둔 것은 이미 올라온 1.1.57~ 보고도 새 빌드 없이 바로 맞게 보이게 하려는 것이다.
 *  - 나머지는 기록 없음
 * 그룹(기구) 수업 · 개인 일정 · 예시 회원은 세지 않는다 -- 회원별 기록을 쓰는 자리가 아니다.
 *
 * @param {{ members?: any[], schedule?: any[], month: string, now?: Date }} input
 */
export function countDeviceRecordActivity({ members = [], schedule = [], month, now = new Date() }) {
  const result = { attended: 0, recorded: 0, draft: 0, voice: 0, manual: 0, noComment: 0 };
  if (!isRecordMonth(month)) return result;
  const memberById = new Map((members || [])
    .filter((member) => member && member.isSample !== true)
    .map((member) => [text(member.id), member]));
  for (const lesson of schedule || []) {
    if (!lesson || lesson.personal || lesson.isSample === true) continue;
    if (!text(lesson.date).startsWith(month) || !lessonEnded(lesson, now)) continue;
    for (const attendee of attendeesOf(lesson)) {
      if (attendee.status !== "done") continue;
      const member = memberById.get(text(attendee.memberId));
      if (!member) continue;
      result.attended += 1;
      const notes = (member.notes || []).filter((note) => note
        && text(note.sid) === text(lesson.id)
        && !["상담", "인바디"].includes(text(note.type))
        && text(note.body));
      const confirmed = notes.find(isServerEligibleNote);
      if (confirmed) {
        result.recorded += 1;
        const kind = kindOf(confirmed);
        if (kind === SERVER_RECORD_KIND.VOICE) result.voice += 1;
        else if (kind === SERVER_RECORD_KIND.NO_COMMENT) result.noComment += 1;
        else result.manual += 1;
      } else if (notes.length) {
        result.draft += 1;
      }
    }
  }
  return result;
}

const count = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, RECORD_ACTIVITY_MAX) : 0;
};

/** 서버에 올리는 문서. 숫자 · 달 · 앱 빌드만. checkedAt 은 저장소가 서버 시각으로 붙인다. */
export function recordActivityDocument({ organizationId, uid, month, counts, appBuild = "" }) {
  return {
    organizationId: text(organizationId),
    userId: text(uid),
    month: text(month),
    attended: count(counts?.attended),
    recorded: count(counts?.recorded),
    draft: count(counts?.draft),
    voice: count(counts?.voice),
    manual: count(counts?.manual),
    noComment: count(counts?.noComment),
    appBuild: text(appBuild).slice(0, 40),
  };
}

/** 같은 숫자를 또 쓰지 않으려고 비교하는 열쇠. */
export const recordActivitySignature = (document) => [
  document.month, document.attended, document.recorded, document.draft, document.voice, document.manual, document.noComment,
].join("|");

const LEDGER_DEDUCT = "deduct";
const LEDGER_CORRECTION = "correction";

/**
 * 대표 화면 한 달 표.
 *
 *   ledger                이 달 원장 차감 · 보정 (occurredAt 이 이 달)
 *   lessonNotes           회원에게 보낸 말 (문서 id = `${lessonId}_${clientId}`)
 *   activities            기기 보고 (이 달)
 *   instructors           소속 명부 (userId · displayName · status)
 *   canonicalInstructorId 계정을 바꾼 강사의 옛 uid → 지금 uid
 *   excludedClientIds     심사용 회원
 *
 * @param {{
 *   ledger?: any[], lessonNotes?: any[], activities?: any[], instructors?: any[],
 *   canonicalInstructorId?: (id: unknown) => string, excludedClientIds?: Set<string> | null,
 * }} input
 */
export function instructorRecordBoard(input = {}) {
  const canonical = typeof input.canonicalInstructorId === "function" ? input.canonicalInstructorId : (id) => text(id);
  const excluded = input.excludedClientIds instanceof Set ? input.excludedClientIds : new Set();
  const rows = new Map();
  const rowOf = (id) => {
    const key = canonical(id) || text(id);
    if (!rows.has(key)) rows.set(key, { instructorId: key, confirmed: 0, withNote: 0, activity: null, _keys: new Set() });
    return rows.get(key);
  };

  /* 확정 수업 = 차감 - 되돌린 차감. 차감 id 는 듀엣이면 두 회원권에 같은 `${lessonId}_deduct` 라 passId 와 함께 본다. */
  const entries = (input.ledger || []).filter(Boolean);
  const corrected = new Set(entries
    .filter((entry) => entry.type === LEDGER_CORRECTION && text(entry.correctsEntryId))
    .map((entry) => `${text(entry.passId)}/${text(entry.correctsEntryId)}`));
  const notes = new Set((input.lessonNotes || [])
    .filter((note) => note && text(note.memberNote))
    .map((note) => `${text(note.lessonId)}|${text(note.clientId)}`));
  for (const entry of entries) {
    if (entry.type !== LEDGER_DEDUCT) continue;
    if (excluded.has(text(entry.clientId))) continue;
    if (corrected.has(`${text(entry.passId)}/${text(entry.id)}`)) continue;
    const key = `${text(entry.lessonId)}|${text(entry.clientId)}`;
    const row = rowOf(entry.instructorId);
    if (row._keys.has(key)) continue;
    row._keys.add(key);
    row.confirmed += 1;
    if (text(entry.lessonId) && notes.has(key)) row.withNote += 1;
  }

  /* 기기 보고. 계정을 바꾼 강사는 옛 폰 · 새 폰 보고가 둘일 수 있다 -- 나중에 확인한 것 하나만. */
  for (const activity of input.activities || []) {
    if (!activity || !text(activity.userId)) continue;
    const row = rowOf(activity.userId);
    const at = checkedMillis(activity.checkedAt);
    if (row.activity && checkedMillis(row.activity.checkedAt) >= at) continue;
    row.activity = activity;
  }

  const roster = new Map((input.instructors || []).map((member) => [canonical(member?.userId) || text(member?.userId), member]));
  /* 명부의 활동 중 강사는 이 달 숫자가 없어도 줄을 세운다 -- "아무것도 안 함" 이 빠지면 안 된다. */
  for (const [id, member] of roster) {
    if (!id || text(member?.status || "active") !== "active") continue;
    if (!["instructor", "manager", "owner", "area_manager"].includes(text(member?.role || "instructor"))) continue;
    rowOf(id);
  }

  return [...rows.values()].map(({ _keys, ...row }) => {
    const member = roster.get(row.instructorId) || null;
    const attended = row.activity ? count(row.activity.attended) : null;
    /* 기록 = 확정 기록 + 확인 안 한 AI 기록 (위 countDeviceRecordActivity 머리말). 둘은 기기에서 겹치지 않게 센다. */
    const recorded = row.activity ? Math.min(RECORD_ACTIVITY_MAX, count(row.activity.recorded) + count(row.activity.draft)) : null;
    const rate = attended ? Math.min(1, recorded / attended) : null;
    return {
      ...row,
      name: text(member?.displayName || member?.name),
      role: text(member?.role),
      active: !member || text(member?.status || "active") === "active",
      attended,
      recorded,
      draft: row.activity ? count(row.activity.draft) : null,
      rate,
      noteRate: row.confirmed ? row.withNote / row.confirmed : null,
      checkedAt: row.activity ? checkedMillis(row.activity.checkedAt) : null,
      appBuild: row.activity ? text(row.activity.appBuild) : "",
    };
  }).filter((row) => row.confirmed > 0 || row.activity || (row.active && roster.has(row.instructorId)))
    .sort(compareRows);
}

function checkedMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : 0;
}

/* 손볼 사람이 위: 기록률 낮은 순 → 보고 없음 → 수업이 없는 사람. 같으면 수업이 많은 쪽이 위. */
function compareRows(left, right) {
  const rank = (row) => {
    if (row.rate !== null) return 0;
    if (row.confirmed > 0) return 1;
    return 2;
  };
  return rank(left) - rank(right)
    || (left.rate ?? 0) - (right.rate ?? 0)
    || right.confirmed - left.confirmed
    || left.name.localeCompare(right.name, "ko");
}

export const RECORD_TONE = Object.freeze({ GOOD: "good", WARN: "warn", BAD: "bad", MUTED: "muted" });

/** 한 줄의 판정 · 문구. 코드는 화면 끝에 함께 (CLAUDE.md 4). */
export function recordRowView(row) {
  if (row.rate === null) {
    if (row.activity && !row.attended) {
      return { tone: RECORD_TONE.MUTED, label: "출석 처리한 수업 없음", code: "no_attended_lessons" };
    }
    return {
      tone: row.confirmed > 0 ? RECORD_TONE.WARN : RECORD_TONE.MUTED,
      label: "폰 앱이 아직 알려주지 않음",
      detail: "1.1.57 이상 앱을 열면 채워져요",
      code: "no_device_report",
    };
  }
  const percent = Math.round(row.rate * 100);
  const missing = Math.max(0, row.attended - row.recorded);
  if (row.rate >= RECORD_RATE_GOOD) return { tone: RECORD_TONE.GOOD, label: `기록 ${percent}%`, detail: missing ? `빠짐 ${missing}건` : "빠짐 없음", code: "record_good" };
  if (row.rate >= RECORD_RATE_LOW) return { tone: RECORD_TONE.WARN, label: `기록 ${percent}%`, detail: `빠짐 ${missing}건`, code: "record_partial" };
  return { tone: RECORD_TONE.BAD, label: `기록 ${percent}%`, detail: `빠짐 ${missing}건`, code: "record_low" };
}

/** 표 위 요약: 잘함 · 보통 · 부족 · 보고 없음 사람 수. */
export function recordBoardSummary(rows) {
  const summary = { good: 0, partial: 0, low: 0, unknown: 0 };
  for (const row of rows || []) {
    const { code } = recordRowView(row);
    if (code === "record_good") summary.good += 1;
    else if (code === "record_partial") summary.partial += 1;
    else if (code === "record_low") summary.low += 1;
    else if (code === "no_device_report") summary.unknown += 1;
  }
  return summary;
}
