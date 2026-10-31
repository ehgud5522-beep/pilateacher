/**
 * 본인 전용 일정 동기화 (2026-10-31, 동기화 3단계). **순수 함수다.**
 *
 * ── 무엇을 ──
 * 센터 수업(lessons, 1 · 2단계)에 실리지 않는 일정을 **그 계정 본인만 읽고 쓰는 자리**
 * `users/{uid}/scheduleItems/{itemId}` 에 둔다. 대표 · FC · 다른 강사 · 회원은 읽지 못한다.
 *
 * | 종류 (kind)   | itemId         | 담는 것 |
 * | personal      | sch_{일정 id}   | 상담 · 휴무 같은 개인 일정 -- 제목 · 날짜 · 시각만 |
 * | group         | sch_{일정 id}   | 회원 id 없이 인원만 적는 그룹 수업 (회원 앱에 나가지 않는다) |
 *
 * **메모는 싣지 않는다** (2026-10-31 대표 결정): 개인 일정 메모 · 수업 메모(그룹 수업 포함) ·
 * 상담 메모 · 회원 목표(운동 목표 · 통증 및 주의사항 · 목표 체중 · 체지방)는 입력한 기기에만
 * 남는다. 회원 건강 · 상담 내용을 서버에 두지 않기 위해서다. 보내지도 받아 합치지도 않고,
 * 기기 값은 건드리지 않는다. 서버 규칙도 그 칸이 든 쓰기를 거절한다.
 * 회원에게 남길 말은 여기와 상관없이 지금처럼 센터 수업 문서(lessons)로 간다.
 *
 * ── 1 · 2단계와 같은 틀 ──
 * 수정 번호(기기는 privateRevision) · 충돌(서버가 이긴다) · 지우지 않고 표시(deletedAt) ·
 * 스위치(따로) · 처음 받기 전 자동 스냅샷.
 *
 * ── 받는 기간 ──
 * **30일 전 ~ 60일 뒤**. 이보다 오래된 것은 입력한 기기에만 남는다.
 */

import { normalizeEquipmentIds } from "./equipment.js";

const text = (value) => String(value ?? "").trim();
const attendeesOf = (entry) => (Array.isArray(entry?.attendees) ? entry.attendees : []);
const revisionOf = (value) => Math.max(0, Number(value) || 0);
const numberOr0 = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const PRIVATE_KIND = Object.freeze({
  PERSONAL: "personal",
  GROUP: "group",
});

export const PRIVATE_WINDOW = Object.freeze({ pastDays: 30, futureDays: 60 });

const pad = (number) => String(number).padStart(2, "0");
const isoDay = (at) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** 받는 범위 (날짜 문자열). */
export function privateWindow(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    from: isoDay(new Date(start.getTime() - PRIVATE_WINDOW.pastDays * day)),
    to: isoDay(new Date(start.getTime() + PRIVATE_WINDOW.futureDays * day)),
  };
}

const isGroupEntry = (entry) => !entry?.personal && text(entry?.type) === "그룹" && attendeesOf(entry).length === 0;

/**
 * 지금 기기 상태에서 서버에 둘 문서들. itemId → { itemId, data, baseRevision }.
 * @param {{ schedule: Array<any> }} input
 */
export function privateDocuments({ schedule = [] } = {}) {
  const out = new Map();
  const put = (itemId, data, baseRevision) => out.set(itemId, { itemId, data: { itemId, ...data }, baseRevision: revisionOf(baseRevision) });

  for (const entry of Array.isArray(schedule) ? schedule : []) {
    const id = text(entry?.id);
    if (!id) continue;
    if (entry.personal) {
      put(`sch_${id}`, {
        kind: PRIVATE_KIND.PERSONAL, date: text(entry.date), start: text(entry.start), end: text(entry.end), title: text(entry.title),
      }, entry.privateRevision);
    } else if (isGroupEntry(entry)) {
      put(`sch_${id}`, {
        kind: PRIVATE_KIND.GROUP, date: text(entry.date), start: text(entry.start), end: text(entry.end),
        type: "그룹", room: text(entry.room), equipmentIds: normalizeEquipmentIds(entry.equipmentIds),
        groupCount: numberOr0(entry.groupCount), actualCount: numberOr0(entry.actualCount), noshowCount: numberOr0(entry.noshowCount),
        groupDone: Boolean(entry.groupDone), groupCancelled: Boolean(entry.groupCancelled),
      }, entry.privateRevision);
    }
  }
  return out;
}

const fingerprint = (data) => JSON.stringify(data);

/**
 * 저장 전후를 견주어 서버에 쓸 것. 바뀐 것과 새 것은 그대로, 사라진 것은 지운 표시로.
 * @returns {Array<{ itemId: string, data: object, baseRevision: number, deleted: boolean }>}
 */
export function privateChanges({ before, after }) {
  const out = [];
  for (const [itemId, document] of after) {
    const previous = before.get(itemId);
    if (previous && fingerprint(previous.data) === fingerprint(document.data)) continue;
    out.push({ ...document, deleted: false });
  }
  for (const [itemId, previous] of before) {
    if (after.has(itemId)) continue;
    out.push({ ...previous, deleted: true });
  }
  return out;
}

/**
 * 서버의 본인 일정을 기기 일정에 합친다. 서버 번호가 기기가 본 번호와 다르면 서버를
 * 따른다. 아직 못 보낸 이 기기의 수정(pendingIds)은 건드리지 않는다. 기기의 다른 칸(메모 ·
 * 출석 따위)은 지킨다. 두 종류 밖의 문서는 받지 않는다.
 *
 * @param {{ schedule: Array<any>, docs: Array<any>, pendingIds?: Iterable<string> }} input
 */
export function mergePrivateItems(input) {
  const pending = new Set([...(input?.pendingIds || [])].map(text));
  const schedule = Array.isArray(input?.schedule) ? [...input.schedule] : [];
  const summary = { added: 0, updated: 0, removed: 0 };
  const duplicates = [];
  let changed = false;

  for (const doc of Array.isArray(input?.docs) ? input.docs : []) {
    const itemId = text(doc?.itemId || doc?.id);
    const kind = text(doc?.kind);
    if (!itemId || pending.has(itemId) || (kind !== PRIVATE_KIND.PERSONAL && kind !== PRIVATE_KIND.GROUP)) continue;
    const serverRevision = revisionOf(doc?.revision);
    const id = itemId.replace(/^sch_/, "");
    const index = schedule.findIndex((entry) => text(entry?.id) === id);
    const local = index >= 0 ? schedule[index] : null;
    if (local && revisionOf(local.privateRevision) === serverRevision) continue;
    if (doc?.deletedAt) {
      if (local) { schedule.splice(index, 1); summary.removed += 1; changed = true; }
      continue;
    }
    const fields = kind === PRIVATE_KIND.PERSONAL
      ? { personal: true, title: text(doc.title), date: text(doc.date), start: text(doc.start), end: text(doc.end), attendees: [] }
      : {
        type: "그룹", date: text(doc.date), start: text(doc.start), end: text(doc.end), room: text(doc.room),
        equipmentIds: normalizeEquipmentIds(doc.equipmentIds), groupCount: numberOr0(doc.groupCount),
        actualCount: numberOr0(doc.actualCount), noshowCount: numberOr0(doc.noshowCount),
        groupDone: Boolean(doc.groupDone), groupCancelled: Boolean(doc.groupCancelled), attendees: [],
      };
    if (local) {
      schedule[index] = { ...local, ...fields, privateRevision: serverRevision };
      summary.updated += 1;
    } else {
      const entry = { id, ...fields, memo: "", privateRevision: serverRevision };
      const twin = schedule.find((other) => text(other?.id) !== id && text(other?.date) === entry.date && text(other?.start) === entry.start
        && (kind === PRIVATE_KIND.PERSONAL ? other?.personal && text(other?.title) === entry.title : isGroupEntry(other)));
      if (twin) duplicates.push({ serverId: id, localId: text(twin.id) });
      schedule.push(entry);
      summary.added += 1;
    }
    changed = true;
  }

  return { schedule: changed ? schedule : input?.schedule || [], changed, summary, duplicates };
}

/** 쓴 결과의 번호를 기기 일정에 적는다. */
export function applyPrivateRevisions({ schedule = [], results = [] }) {
  let nextSchedule = schedule;
  for (const result of Array.isArray(results) ? results : []) {
    if (!["written", "unchanged"].includes(result?.outcome)) continue;
    const id = String(result.itemId || "").replace(/^sch_/, "");
    const revision = Number(result.revision) || 0;
    nextSchedule = nextSchedule.map((entry) => (entry.id === id && entry.privateRevision !== revision ? { ...entry, privateRevision: revision } : entry));
  }
  return { schedule: nextSchedule };
}
