/**
 * 서버의 내 수업 일정을 기기 일정에 합친다 (2026-10-31, 동기화 2단계). **순수 함수다.**
 *
 * ── 왜 ──
 * 일정은 기기 → 서버 한 방향뿐이었다. PC 웹에서 넣은 일정이 강사 폰에 안 보였고,
 * 센터 PC 두 대는 서로의 일정을 몰랐다. 이제 앱이 열려 있는 동안 서버의 **내 수업
 * 일정만**(instructorId == 나, 7일 전 ~ 60일 뒤) 받아 여기서 기기 일정에 합친다.
 *
 * ── 원칙 ──
 * - **예정 일정은 서버가 기준이다.** 서버 번호(revision)가 기기가 본 번호보다 크면
 *   핵심 칸(날짜 · 시각 · 종류 · 회원 · 방 · 기구)을 서버 것으로 바꾼다
 * - **기기의 것은 지우지 않는다** -- 메모 · 출석 상태 · 확정 기록은 기기 것을 지킨다.
 *   서버에서 지운 일정도, 기기에 출석으로 뺀 회차가 있으면 지우지 않고 알린다
 * - **확정된 수업은 어느 쪽도 덮지 않는다.** 다른 기기에서 확정됐으면 잠근다
 *   (settledElsewhereAt) -- 이 기기에서 고치지도, 또 확정하지도 못한다
 * - 아직 서버에 못 보낸 이 기기의 수정(pendingIds)은 건드리지 않는다. 그 쓰기가
 *   서버와 견주어 정리한다 (lesson-schedule-repository.js 의 CONFLICT)
 * - 같은 수업을 두 기기에서 따로 넣은 것(id 가 다름)은 "중복 의심" 으로 알린다.
 *   자동으로 지우지 않는다
 */

import { normalizeEquipmentIds } from "./equipment.js";
import { isSettledElsewhere } from "./schedule-edit.js";

const text = (value) => String(value ?? "").trim();
const attendeesOf = (entry) => (Array.isArray(entry?.attendees) ? entry.attendees : []);

/** 받는 범위. 내 수업만, 7일 전부터 60일 뒤까지 (2026-10-31 대표). */
export const SYNC_WINDOW = Object.freeze({ pastDays: 7, futureDays: 60 });

export function syncWindow(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    from: new Date(start.getTime() - SYNC_WINDOW.pastDays * day),
    to: new Date(start.getTime() + (SYNC_WINDOW.futureDays + 1) * day),
  };
}

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
};
const pad = (number) => String(number).padStart(2, "0");
const isoDay = (at) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const clock = (at) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;
const revisionOf = (value) => Math.max(0, Number(value) || 0);

/** 서버 문서의 종류 -- 3단계 문서에는 scheduleType 이 없어 수업 유형에서 고른다. */
function scheduleTypeOf(doc) {
  const stored = text(doc?.scheduleType);
  if (stored) return stored;
  return text(doc?.lessonType) === "2:1" ? "듀엣" : "개인레슨";
}

/** 센터 회원 id → 이 기기 명부의 회원 id. 명부에 없는 회원은 빠진다. */
function rosterIndex(rosterMembers) {
  const byClient = new Map();
  for (const member of Array.isArray(rosterMembers) ? rosterMembers : []) {
    const clientId = text(member?.orgClientId);
    if (clientId && !byClient.has(clientId)) byClient.set(clientId, member);
  }
  return byClient;
}

/**
 * 서버 문서의 회원을 기기 출석 목록으로. 같은 회원의 기기 출석 상태 · 뺀 회차 ·
 * 노쇼비는 그대로 둔다. 서버 목록에 없는 기기 출석 중 취소한 사람과 센터 명부에
 * 없는 회원은 지우지 않고 남긴다.
 */
function mergedAttendees(doc, local, byClient) {
  const careGrades = doc?.careGrades && typeof doc.careGrades === "object" ? doc.careGrades : {};
  const previous = new Map(attendeesOf(local).map((attendee) => [text(attendee?.memberId), attendee]));
  const fromServer = [];
  const unmatched = [];
  for (const clientId of Array.isArray(doc?.clientIds) ? doc.clientIds.map(text) : []) {
    const member = byClient.get(clientId);
    if (!member) { unmatched.push(clientId); continue; }
    const kept = previous.get(text(member.id));
    const grade = text(careGrades[clientId]);
    fromServer.push({
      ...(kept || { memberId: member.id, status: "booked", deductFrom: null, noshowFee: null }),
      ...(grade ? { careGrade: grade } : {}),
    });
  }
  const serverIds = new Set(fromServer.map((attendee) => text(attendee.memberId)));
  const memberIdsInRoster = new Set([...byClient.values()].map((member) => text(member.id)));
  const keptLocal = attendeesOf(local).filter((attendee) => {
    const id = text(attendee?.memberId);
    if (serverIds.has(id)) return false;
    return text(attendee?.status) === "cancel" || !memberIdsInRoster.has(id);
  });
  return { attendees: [...fromServer, ...keptLocal], unmatched };
}

/** 서버 문서로 기기 일정의 핵심 칸을 만든다. 메모는 없다 -- 메모는 기기에만 있다. */
function coreFromServer(doc, staffName) {
  const startsAt = toDate(doc?.startsAt);
  if (!startsAt) return null;
  const endsAt = toDate(doc?.endsAt);
  return {
    date: text(doc?.date) || isoDay(startsAt),
    start: clock(startsAt),
    end: endsAt && endsAt > startsAt ? clock(endsAt) : clock(new Date(startsAt.getTime() + 50 * 60 * 1000)),
    type: scheduleTypeOf(doc),
    room: text(doc?.room),
    equipmentIds: normalizeEquipmentIds(doc?.equipmentIds),
    ...(staffName ? { instructor: staffName } : {}),
  };
}

const memberSet = (entry) => attendeesOf(entry).map((attendee) => text(attendee?.memberId)).filter(Boolean).sort().join(",");

/**
 * @param {{
 *   schedule: Array<any>, docs: Array<any>, rosterMembers: Array<any>,
 *   staffName?: string, pendingIds?: Iterable<string>, now?: Date,
 * }} input
 * @returns {{
 *   schedule: Array<any>, changed: boolean,
 *   summary: { added: number, updated: number, removed: number, attendanceCancelled: number, lockedElsewhere: number, unlocked: number, keptWithDeductions: number },
 *   unmatchedClientIds: Array<string>, duplicates: Array<{ serverId: string, localId: string }>,
 *   removedIds: Array<string>,
 * }}
 */
export function mergeServerLessons(input) {
  const schedule = Array.isArray(input?.schedule) ? input.schedule : [];
  const docs = Array.isArray(input?.docs) ? input.docs : [];
  const pending = new Set([...(input?.pendingIds || [])].map(text));
  const byClient = rosterIndex(input?.rosterMembers);
  const staffName = text(input?.staffName);
  const nowIso = (input?.now instanceof Date ? input.now : new Date()).toISOString();

  const summary = { added: 0, updated: 0, removed: 0, attendanceCancelled: 0, lockedElsewhere: 0, unlocked: 0, keptWithDeductions: 0 };
  const unmatchedClientIds = new Set();
  const duplicates = [];
  const removedIds = [];
  const docIds = new Set(docs.map((doc) => text(doc?.lessonId || doc?.id)));
  const byId = new Map(schedule.map((entry) => [text(entry?.id), entry]));
  const removals = new Set();
  const additions = [];

  for (const doc of docs) {
    const id = text(doc?.lessonId || doc?.id);
    if (!id || pending.has(id)) continue;
    const status = text(doc?.status);
    const local = byId.get(id);
    const serverRevision = revisionOf(doc?.revision);
    const localRevision = revisionOf(local?.syncRevision);

    if (status === "completed") {
      /* 다른 기기에서 확정됐다. 이 기기에 확정 기록이 없으면 잠근다. */
      if (local && !local.orgSettledAt && !isSettledElsewhere(local)) {
        byId.set(id, { ...local, settledElsewhereAt: toDate(doc?.updatedAt)?.toISOString() || nowIso });
        summary.lockedElsewhere += 1;
      }
      continue;
    }
    /* 다른 기기에서 확정을 되돌렸다 -- 잠금을 푼다. */
    if (local && isSettledElsewhere(local)) {
      const { settledElsewhereAt: _released, ...rest } = local;
      byId.set(id, rest);
      summary.unlocked += 1;
    }
    const current = byId.get(id);

    if (status === "cancelled") {
      if (!current || serverRevision <= localRevision) continue;
      if (doc?.deletedAt) {
        /* 지운 일정. 출석으로 뺀 회차(기기 모드)가 있으면 지우지 않는다 -- 지우면
           그 회차를 되돌릴 자리가 사라진다. */
        if (attendeesOf(current).some((attendee) => attendee?.deductFrom)) {
          summary.keptWithDeductions += 1;
          continue;
        }
        removals.add(id);
        removedIds.push(id);
        summary.removed += 1;
      } else {
        /* 출석 전원 취소. 일정은 남기고 센터 회원의 출석을 취소로. */
        const linkedIds = new Set([...byClient.values()].map((member) => text(member.id)));
        byId.set(id, {
          ...current,
          attendees: attendeesOf(current).map((attendee) => (linkedIds.has(text(attendee?.memberId))
            ? { ...attendee, status: "cancel" } : attendee)),
          syncRevision: serverRevision,
        });
        summary.attendanceCancelled += 1;
      }
      continue;
    }

    if (status !== "scheduled") continue;
    const core = coreFromServer(doc, current ? "" : staffName);
    if (!core) continue;
    if (!current) {
      const { attendees, unmatched } = mergedAttendees(doc, null, byClient);
      unmatched.forEach((clientId) => unmatchedClientIds.add(clientId));
      if (!attendees.length) continue;
      const entry = { id, ...core, memo: "", attendees, syncRevision: serverRevision };
      /* 같은 수업을 이 기기에서도 따로 넣었는가 -- 같은 날 · 같은 시각 · 같은 회원,
         id 는 다르고 서버에 없는 기기 일정. */
      const twin = schedule.find((other) => text(other?.id) !== id && !docIds.has(text(other?.id))
        && text(other?.date) === entry.date && text(other?.start) === entry.start
        && memberSet(other) === memberSet(entry));
      if (twin) duplicates.push({ serverId: id, localId: text(twin.id) });
      additions.push(entry);
      summary.added += 1;
      continue;
    }
    if (serverRevision <= localRevision) continue;
    const { attendees, unmatched } = mergedAttendees(doc, current, byClient);
    unmatched.forEach((clientId) => unmatchedClientIds.add(clientId));
    byId.set(id, { ...current, ...core, attendees, syncRevision: serverRevision });
    summary.updated += 1;
  }

  const next = [
    ...schedule.map((entry) => byId.get(text(entry?.id)) || entry).filter((entry) => !removals.has(text(entry?.id))),
    ...additions,
  ];
  const changed = summary.added + summary.updated + summary.removed + summary.attendanceCancelled
    + summary.lockedElsewhere + summary.unlocked > 0;
  return {
    schedule: changed ? next : schedule,
    changed,
    summary,
    unmatchedClientIds: [...unmatchedClientIds],
    duplicates,
    removedIds,
  };
}

/**
 * 서버에 쓴 결과의 번호를 기기 일정에 적는다. 다음 쓰기가 이 번호를 들고 간다.
 * 바뀐 것이 없으면 같은 배열을 돌려준다 -- 저장을 다시 부르지 않게.
 */
export function applyPublishedRevisions(schedule, results) {
  const list = Array.isArray(schedule) ? schedule : [];
  const revisions = new Map((Array.isArray(results) ? results : [])
    .filter((result) => (result?.outcome === "written" || result?.outcome === "unchanged") && Number.isFinite(Number(result?.revision)))
    .map((result) => [text(result.lessonId), Number(result.revision)]));
  let changed = false;
  const next = list.map((entry) => {
    const revision = revisions.get(text(entry?.id));
    if (revision === undefined || revisionOf(entry?.syncRevision) === revision) return entry;
    changed = true;
    return { ...entry, syncRevision: revision };
  });
  return changed ? next : list;
}

/** 다시 적용할 때 견주는 칸 -- 서버로 가는 핵심 칸과 같다. */
const REAPPLY_FIELDS = ["date", "start", "end", "type", "room", "equipmentIds", "attendees"];

/**
 * [내 수정 다시 적용] -- **내가 바꾼 칸만** 서버 최신 위에 얹는다 (2026-10-31).
 * 통째로 덮으면 다른 기기가 바꾼 칸(예: 방)을 내 옛 값으로 되돌린다.
 *
 * @param {any} current  서버 최신으로 맞춰진 기기 일정
 * @param {any} before   내가 고치기 전
 * @param {any} after    내가 고친 뒤
 */
export function reapplyChanges(current, before, after) {
  if (!current) return after || null;
  if (!before || !after) return current;
  const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  const patch = Object.fromEntries(REAPPLY_FIELDS
    .filter((field) => !same(before[field], after[field]))
    .map((field) => [field, after[field]]));
  return { ...current, ...patch };
}
